use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::str;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, ErrorCode, params};
use serde_json::{Value, json};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use wasmtime::{
    Caller, Config, Engine, Extern, ExternType, Linker, Memory, Module, Store, StoreLimits,
    StoreLimitsBuilder, TypedFunc, ValType,
};

const BODY_LIMIT: usize = 32_768;
const INPUT_OFFSET: usize = 1_024;
const MAX_MEMORY_BYTES: usize = 4 * 1_024 * 1_024;
const FUEL_PER_REQUEST: u64 = 10_000_000;

fn main() {
    if let Err(error) = run() {
        eprintln!("benchmark-host: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let command = arguments.first().map(String::as_str).unwrap_or("");
    let options = Options::parse(arguments.get(1..).unwrap_or_default())?;
    match command {
        "inspect" => {
            let engine = engine()?;
            let module = Module::from_file(&engine, &options.wasm).map_err(|error| {
                anyhow::anyhow!("could not load `{}`: {error}", options.wasm.display())
            })?;
            let policy = RuntimePolicy::load(options.capability_manifest.as_ref())?;
            verify_module(&module, &policy)?;
            println!("module accepted");
            Ok(())
        }
        "serve" => serve(options),
        _ => bail!("usage: air-benchmark-host <inspect|serve> --wasm module.wasm [options]"),
    }
}

fn serve(options: Options) -> Result<()> {
    let policy = RuntimePolicy::load(options.capability_manifest.as_ref())?;
    let database_path = options
        .database
        .as_ref()
        .context("serve requires --db database.sqlite")?;
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("could not create `{}`", parent.display()))?;
    }
    let connection = Connection::open(database_path)
        .with_context(|| format!("could not open `{}`", database_path.display()))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS users (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           email TEXT NOT NULL UNIQUE
         );",
    )?;

    let engine = engine()?;
    let module = Module::from_file(&engine, &options.wasm)
        .map_err(|error| anyhow::anyhow!("could not load `{}`: {error}", options.wasm.display()))?;
    verify_module(&module, &policy)?;

    let limits = StoreLimitsBuilder::new()
        .memory_size(policy.maximum_memory_bytes)
        .instances(policy.maximum_instances)
        .memories(policy.maximum_memories)
        .tables(policy.maximum_tables)
        .table_elements(policy.maximum_table_elements)
        .build();
    let mut store = Store::new(
        &engine,
        HostState {
            connection,
            limits,
            storage_unavailable: options.storage_unavailable,
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(policy.fuel_per_request)?;

    let mut linker = Linker::new(&engine);
    linker.func_wrap(
        "air_sqlite_v1",
        "insert_user",
        |mut caller: Caller<'_, HostState>,
         name_pointer: i32,
         name_length: i32,
         email_pointer: i32,
         email_length: i32|
         -> i64 {
            insert_user(
                &mut caller,
                name_pointer,
                name_length,
                email_pointer,
                email_length,
            )
        },
    )?;
    let instance = linker.instantiate(&mut store, &module)?;
    let memory = instance
        .get_memory(&mut store, "memory")
        .context("candidate does not export `memory`")?;
    let handler = instance
        .get_typed_func::<(i32, i32, i32, i32), i64>(&mut store, "handle_create_user")
        .map_err(|error| {
            anyhow::anyhow!(
                "candidate does not export the required `handle_create_user` function: {error}"
            )
        })?;

    let server = Server::http(format!("{}:{}", options.host, options.port))
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let address = server
        .server_addr()
        .to_ip()
        .context("benchmark host did not bind an IP socket")?;
    println!("listening http://{}:{}", options.host, address.port());

    let mut runtime = Runtime {
        store,
        memory,
        handler,
        fuel_per_request: policy.fuel_per_request,
    };
    let mut handled = 0_u64;
    loop {
        let request = server.recv()?;
        handle_http(request, &mut runtime)?;
        handled += 1;
        if options
            .max_requests
            .is_some_and(|maximum| handled >= maximum)
        {
            break;
        }
    }
    Ok(())
}

fn engine() -> Result<Engine> {
    let mut configuration = Config::new();
    configuration.consume_fuel(true);
    Ok(Engine::new(&configuration)?)
}

fn verify_module(module: &Module, policy: &RuntimePolicy) -> Result<()> {
    let imports: Vec<_> = module.imports().collect();
    if imports.len() != policy.allowed_imports.len() {
        bail!(
            "candidate requested {} imports; capability manifest allows {}",
            imports.len(),
            policy.allowed_imports.len()
        );
    }
    for import in &imports {
        let declared = policy
            .allowed_imports
            .iter()
            .any(|allowed| allowed.module == import.module() && allowed.name == import.name());
        if !declared {
            bail!(
                "undeclared capability import `{}.{}`",
                import.module(),
                import.name()
            );
        }
    }
    let import = imports
        .iter()
        .find(|import| import.module() == "air_sqlite_v1" && import.name() == "insert_user")
        .context("capability manifest contains an unsupported import")?;
    let ExternType::Func(function) = import.ty() else {
        bail!("`air_sqlite_v1.insert_user` must be a function");
    };
    let parameters: Vec<_> = function.params().collect();
    let results: Vec<_> = function.results().collect();
    if parameters.len() != 4
        || !parameters.iter().all(|value| matches!(value, ValType::I32))
        || results.len() != 1
        || !matches!(results[0], ValType::I64)
    {
        bail!("`air_sqlite_v1.insert_user` has an incompatible type");
    }

    let memory = module
        .exports()
        .find(|export| export.name() == "memory")
        .context("candidate does not export `memory`")?;
    if !matches!(memory.ty(), ExternType::Memory(_)) {
        bail!("candidate export `memory` is not linear memory");
    }

    let handler = module
        .exports()
        .find(|export| export.name() == "handle_create_user")
        .context("candidate does not export `handle_create_user`")?;
    let ExternType::Func(function) = handler.ty() else {
        bail!("candidate export `handle_create_user` is not a function");
    };
    let parameters: Vec<_> = function.params().collect();
    let results: Vec<_> = function.results().collect();
    if parameters.len() != 4
        || !parameters.iter().all(|value| matches!(value, ValType::I32))
        || results.len() != 1
        || !matches!(results[0], ValType::I64)
    {
        bail!("candidate export `handle_create_user` has an incompatible type");
    }
    Ok(())
}

fn insert_user(
    caller: &mut Caller<'_, HostState>,
    name_pointer: i32,
    name_length: i32,
    email_pointer: i32,
    email_length: i32,
) -> i64 {
    if caller.data().storage_unavailable {
        return -3;
    }
    let Some(Extern::Memory(memory)) = caller.get_export("memory") else {
        return -3;
    };
    let Some(name) = read_guest_string(&memory, caller, name_pointer, name_length) else {
        return -3;
    };
    let Some(email) = read_guest_string(&memory, caller, email_pointer, email_length) else {
        return -3;
    };
    match caller.data_mut().connection.execute(
        "INSERT INTO users (name, email) VALUES (?1, ?2)",
        params![name, email],
    ) {
        Ok(1) => caller.data().connection.last_insert_rowid(),
        Ok(_) => -3,
        Err(error) if error.sqlite_error_code() == Some(ErrorCode::ConstraintViolation) => -4,
        Err(_) => -3,
    }
}

fn read_guest_string(
    memory: &Memory,
    caller: &Caller<'_, HostState>,
    pointer: i32,
    length: i32,
) -> Option<String> {
    let pointer = usize::try_from(pointer).ok()?;
    let length = usize::try_from(length).ok()?;
    let end = pointer.checked_add(length)?;
    let bytes = memory.data(caller).get(pointer..end)?;
    str::from_utf8(bytes).ok().map(str::to_owned)
}

fn handle_http(mut request: Request, runtime: &mut Runtime) -> Result<()> {
    if request.url() != "/users" {
        return respond(request, 404, json!({ "error": "not_found" }));
    }
    if request.method() != &Method::Post {
        return respond(request, 405, json!({ "error": "method_not_allowed" }));
    }
    let is_json = request.headers().iter().any(|header| {
        header.field.equiv("content-type")
            && header
                .value
                .as_str()
                .split(';')
                .next()
                .is_some_and(|value| value.trim() == "application/json")
    });
    if !is_json {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    }

    let mut body = Vec::new();
    request
        .as_reader()
        .take((BODY_LIMIT + 1) as u64)
        .read_to_end(&mut body)?;
    if body.len() > BODY_LIMIT {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    }
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    };
    let Some(object) = value.as_object() else {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    };
    if object.len() != 2 || !object.contains_key("name") || !object.contains_key("email") {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    }
    let (Some(name), Some(email)) = (
        object.get("name").and_then(Value::as_str),
        object.get("email").and_then(Value::as_str),
    ) else {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    };

    let email_offset = INPUT_OFFSET
        .checked_add(name.len())
        .context("name offset overflow")?;
    let end = email_offset
        .checked_add(email.len())
        .context("email offset overflow")?;
    if end > runtime.memory.data_size(&runtime.store) {
        return respond(request, 400, json!({ "error": "invalid_json" }));
    }
    runtime
        .memory
        .write(&mut runtime.store, INPUT_OFFSET, name.as_bytes())?;
    runtime
        .memory
        .write(&mut runtime.store, email_offset, email.as_bytes())?;
    runtime.store.set_fuel(runtime.fuel_per_request)?;
    let result = runtime.handler.call(
        &mut runtime.store,
        (
            INPUT_OFFSET as i32,
            name.len() as i32,
            email_offset as i32,
            email.len() as i32,
        ),
    );
    let result = match result {
        Ok(result) => result,
        Err(_) => return respond(request, 500, json!({ "error": "storage_failure" })),
    };
    match result {
        id if id > 0 => respond(request, 201, json!({ "id": id })),
        -1 => respond(request, 400, json!({ "error": "invalid_name" })),
        -2 => respond(request, 400, json!({ "error": "invalid_email" })),
        -4 => respond(request, 409, json!({ "error": "duplicate_email" })),
        _ => respond(request, 500, json!({ "error": "storage_failure" })),
    }
}

fn respond(request: Request, status: u16, value: Value) -> Result<()> {
    let body = serde_json::to_string(&value)?;
    let content_type = Header::from_bytes(
        b"content-type".as_slice(),
        b"application/json; charset=utf-8".as_slice(),
    )
    .map_err(|_| anyhow::anyhow!("invalid content-type header"))?;
    let cache_control = Header::from_bytes(b"cache-control".as_slice(), b"no-store".as_slice())
        .map_err(|_| anyhow::anyhow!("invalid cache-control header"))?;
    request.respond(
        Response::from_string(body)
            .with_status_code(StatusCode(status))
            .with_header(content_type)
            .with_header(cache_control),
    )?;
    Ok(())
}

struct Runtime {
    store: Store<HostState>,
    memory: Memory,
    handler: TypedFunc<(i32, i32, i32, i32), i64>,
    fuel_per_request: u64,
}

struct HostState {
    connection: Connection,
    limits: StoreLimits,
    storage_unavailable: bool,
}

struct Options {
    wasm: PathBuf,
    database: Option<PathBuf>,
    host: String,
    port: u16,
    max_requests: Option<u64>,
    storage_unavailable: bool,
    capability_manifest: Option<PathBuf>,
}

impl Options {
    fn parse(arguments: &[String]) -> Result<Self> {
        let mut wasm = None;
        let mut database = None;
        let mut host = "127.0.0.1".to_string();
        let mut port = 0_u16;
        let mut max_requests = None;
        let mut storage_unavailable = false;
        let mut capability_manifest = None;
        let mut cursor = 0;
        while cursor < arguments.len() {
            let flag = &arguments[cursor];
            if flag == "--storage-unavailable" {
                storage_unavailable = true;
                cursor += 1;
                continue;
            }
            let value = arguments
                .get(cursor + 1)
                .with_context(|| format!("missing value for `{flag}`"))?;
            match flag.as_str() {
                "--wasm" => wasm = Some(PathBuf::from(value)),
                "--db" => database = Some(PathBuf::from(value)),
                "--host" => host = value.clone(),
                "--port" => port = value.parse().context("--port must be a u16")?,
                "--max-requests" => {
                    max_requests = Some(value.parse().context("--max-requests must be a u64")?)
                }
                "--capability-manifest" => capability_manifest = Some(PathBuf::from(value)),
                _ => bail!("unknown option `{flag}`"),
            }
            cursor += 2;
        }
        Ok(Self {
            wasm: wasm.context("missing --wasm")?,
            database,
            host,
            port,
            max_requests,
            storage_unavailable,
            capability_manifest,
        })
    }
}

#[derive(Clone)]
struct AllowedImport {
    module: String,
    name: String,
}

struct RuntimePolicy {
    allowed_imports: Vec<AllowedImport>,
    maximum_memory_bytes: usize,
    fuel_per_request: u64,
    maximum_instances: usize,
    maximum_memories: usize,
    maximum_tables: usize,
    maximum_table_elements: usize,
}

impl RuntimePolicy {
    fn load(path: Option<&PathBuf>) -> Result<Self> {
        let Some(path) = path else {
            return Ok(Self::benchmark_default());
        };
        let bytes = fs::read(path)
            .with_context(|| format!("could not read capability manifest `{}`", path.display()))?;
        let value: Value = serde_json::from_slice(&bytes)
            .with_context(|| format!("invalid capability manifest `{}`", path.display()))?;
        if value.get("schema_version").and_then(Value::as_u64) != Some(1) {
            bail!("capability manifest schema_version must be 1");
        }
        let imports = value
            .get("allowed_imports")
            .and_then(Value::as_array)
            .context("capability manifest allowed_imports must be an array")?;
        let mut allowed_imports = Vec::new();
        for import in imports {
            let module = import
                .get("module")
                .and_then(Value::as_str)
                .context("capability import module must be a string")?;
            let name = import
                .get("name")
                .and_then(Value::as_str)
                .context("capability import name must be a string")?;
            allowed_imports.push(AllowedImport {
                module: module.to_string(),
                name: name.to_string(),
            });
        }
        for (index, import) in allowed_imports.iter().enumerate() {
            if import.module != "air_sqlite_v1" || import.name != "insert_user" {
                bail!(
                    "capability manifest requests unsupported import `{}.{}`",
                    import.module,
                    import.name
                );
            }
            if allowed_imports[..index]
                .iter()
                .any(|earlier| earlier.module == import.module && earlier.name == import.name)
            {
                bail!(
                    "capability manifest repeats import `{}.{}`",
                    import.module,
                    import.name
                );
            }
        }
        let resources = value
            .get("resources")
            .and_then(Value::as_object)
            .context("capability manifest resources must be an object")?;
        Ok(Self {
            allowed_imports,
            maximum_memory_bytes: resource_usize(resources, "guest_memory_bytes")?,
            fuel_per_request: resource_u64(resources, "fuel_per_request")?,
            maximum_instances: resource_usize(resources, "maximum_instances")?,
            maximum_memories: resource_usize(resources, "maximum_memories")?,
            maximum_tables: resource_usize(resources, "maximum_tables")?,
            maximum_table_elements: resource_usize(resources, "maximum_table_elements")?,
        })
    }

    fn benchmark_default() -> Self {
        Self {
            allowed_imports: vec![AllowedImport {
                module: "air_sqlite_v1".to_string(),
                name: "insert_user".to_string(),
            }],
            maximum_memory_bytes: MAX_MEMORY_BYTES,
            fuel_per_request: FUEL_PER_REQUEST,
            maximum_instances: 1,
            maximum_memories: 1,
            maximum_tables: 1,
            maximum_table_elements: 1_024,
        }
    }
}

fn resource_u64(resources: &serde_json::Map<String, Value>, name: &str) -> Result<u64> {
    let value = resources
        .get(name)
        .and_then(Value::as_u64)
        .with_context(|| format!("capability manifest resource `{name}` must be an integer"))?;
    if value == 0 {
        bail!("capability manifest resource `{name}` must be positive");
    }
    Ok(value)
}

fn resource_usize(resources: &serde_json::Map<String, Value>, name: &str) -> Result<usize> {
    usize::try_from(resource_u64(resources, name)?)
        .with_context(|| format!("capability manifest resource `{name}` is too large"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::RuntimePolicy;

    const RESOURCES: &str = r#""resources": {
      "guest_memory_bytes": 4194304,
      "fuel_per_request": 10000000,
      "maximum_instances": 1,
      "maximum_memories": 1,
      "maximum_tables": 1,
      "maximum_table_elements": 1024
    }"#;

    #[test]
    fn loads_supported_runtime_manifest() {
        let path = temporary_manifest("supported");
        fs::write(
            &path,
            format!(
                r#"{{"schema_version":1,"allowed_imports":[{{"module":"air_sqlite_v1","name":"insert_user"}}],{RESOURCES}}}"#
            ),
        )
        .unwrap();
        let policy = RuntimePolicy::load(Some(&path)).unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(policy.allowed_imports.len(), 1);
        assert_eq!(policy.fuel_per_request, 10_000_000);
    }

    #[test]
    fn rejects_unsupported_runtime_manifest_import() {
        let path = temporary_manifest("unsupported");
        fs::write(
            &path,
            format!(
                r#"{{"schema_version":1,"allowed_imports":[{{"module":"wasi_snapshot_preview1","name":"environ_get"}}],{RESOURCES}}}"#
            ),
        )
        .unwrap();
        let error = RuntimePolicy::load(Some(&path)).err().unwrap();
        fs::remove_file(path).unwrap();
        assert!(error.to_string().contains("unsupported import"));
    }

    fn temporary_manifest(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "air-benchmark-runtime-policy-{}-{name}-{nonce}.json",
            std::process::id()
        ))
    }
}
