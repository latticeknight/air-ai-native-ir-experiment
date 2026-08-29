use std::fs;
use std::io::Read;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use rusqlite::{Connection, ErrorCode, OptionalExtension, params};
use serde_json::{Value, json};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use wasmtime::{
    Caller, Config, Engine, Extern, ExternType, Linker, Memory, Module, Store, StoreLimits,
    StoreLimitsBuilder, TypedFunc, ValType,
};

const BODY_LIMIT: usize = 32_768;
const RESPONSE_LIMIT: usize = 65_536;
const DEFAULT_MEMORY_BYTES: usize = 16 * 1_024 * 1_024;
const DEFAULT_FUEL: u64 = 20_000_000;

fn main() {
    if let Err(error) = run() {
        eprintln!("longitudinal-host: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let command = arguments.first().map(String::as_str).unwrap_or("");
    let options = Options::parse(arguments.get(1..).unwrap_or_default())?;
    match command {
        "describe" => describe(&options),
        "serve" => serve(options),
        _ => bail!(
            "usage: air-longitudinal-host <describe|serve> --wasm module.wasm [--policy policy.json] [--db database.sqlite]"
        ),
    }
}

fn describe(options: &Options) -> Result<()> {
    let engine = engine()?;
    let module = load_module(&engine, &options.wasm)?;
    let imports = module
        .imports()
        .map(|import| json!({ "module": import.module(), "name": import.name() }))
        .collect::<Vec<_>>();
    verify_exports(&module)?;
    println!("{}", json!({ "imports": imports }));
    Ok(())
}

fn serve(options: Options) -> Result<()> {
    let policy_file = options
        .policy
        .as_ref()
        .context("serve requires --policy policy.json")?;
    let database_file = options
        .database
        .as_ref()
        .context("serve requires --db database.sqlite")?;
    if let Some(parent) = database_file.parent() {
        fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(database_file)
        .with_context(|| format!("could not open `{}`", database_file.display()))?;
    initialize_database(&connection)?;

    let policy = RuntimePolicy::load(policy_file)?;
    let engine = engine()?;
    let module = load_module(&engine, &options.wasm)?;
    verify_module(&module, &policy)?;

    let limits = StoreLimitsBuilder::new()
        .memory_size(policy.maximum_memory_bytes)
        .instances(1)
        .memories(1)
        .tables(1)
        .table_elements(1_024)
        .build();
    let mut store = Store::new(&engine, HostState { connection, limits });
    store.limiter(|state| &mut state.limits);
    store.set_fuel(policy.fuel_per_request)?;

    let mut linker = Linker::new(&engine);
    register_operations(&mut linker)?;
    let instance = linker.instantiate(&mut store, &module)?;
    let memory = instance
        .get_memory(&mut store, "memory")
        .context("candidate does not export `memory`")?;
    let allocate = instance
        .get_typed_func::<i32, i32>(&mut store, "alloc")
        .map_err(|error| {
            anyhow::anyhow!("candidate does not export compatible `alloc`: {error}")
        })?;
    let handle = instance
        .get_typed_func::<(i32, i32), i64>(&mut store, "handle_request")
        .map_err(|error| {
            anyhow::anyhow!("candidate does not export compatible `handle_request`: {error}")
        })?;
    let deallocate = instance
        .get_typed_func::<(i32, i32), ()>(&mut store, "dealloc")
        .ok();

    let server = Server::http(format!("{}:{}", options.host, options.port))
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let address = server
        .server_addr()
        .to_ip()
        .context("host did not bind an IP socket")?;
    println!("listening http://{}:{}", options.host, address.port());

    let mut runtime = Runtime {
        store,
        memory,
        allocate,
        handle,
        deallocate,
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

fn load_module(engine: &Engine, file: &PathBuf) -> Result<Module> {
    Module::from_file(engine, file)
        .map_err(|error| anyhow::anyhow!("could not load `{}`: {error}", file.display()))
}

fn initialize_database(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS users (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           email TEXT NOT NULL UNIQUE,
           verified INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'active',
           suspension_reason TEXT,
           deleted_at TEXT,
           internal_metadata TEXT NOT NULL DEFAULT 'host-internal'
         );
         CREATE TABLE IF NOT EXISTS email_audit (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id INTEGER NOT NULL,
           old_email TEXT NOT NULL,
           new_email TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS profiles (
           user_id INTEGER PRIMARY KEY,
           timezone TEXT NOT NULL
         );",
    )?;
    Ok(())
}

#[derive(Clone, Copy)]
enum Operation {
    InsertUser,
    GetUser,
    UpdateName,
    UpdateEmail,
    AppendEmailAudit,
    SoftDeleteUser,
    UpdateStatus,
    UpsertProfile,
}

fn register_operations(linker: &mut Linker<HostState>) -> Result<()> {
    register(linker, "air_users_v1", "insert_user", Operation::InsertUser)?;
    register(linker, "air_users_v1", "get_user", Operation::GetUser)?;
    register(linker, "air_users_v1", "update_name", Operation::UpdateName)?;
    register(
        linker,
        "air_users_v1",
        "update_email",
        Operation::UpdateEmail,
    )?;
    register(
        linker,
        "air_audit_v1",
        "append_email_change",
        Operation::AppendEmailAudit,
    )?;
    register(
        linker,
        "air_users_v1",
        "soft_delete_user",
        Operation::SoftDeleteUser,
    )?;
    register(
        linker,
        "air_users_v1",
        "update_status",
        Operation::UpdateStatus,
    )?;
    register(
        linker,
        "air_profiles_v1",
        "upsert_profile",
        Operation::UpsertProfile,
    )?;
    Ok(())
}

fn register(
    linker: &mut Linker<HostState>,
    module: &'static str,
    name: &'static str,
    operation: Operation,
) -> Result<()> {
    linker.func_wrap(
        module,
        name,
        move |mut caller: Caller<'_, HostState>,
              input_pointer: i32,
              input_length: i32,
              output_pointer: i32,
              output_capacity: i32|
              -> i32 {
            execute_operation(
                &mut caller,
                operation,
                input_pointer,
                input_length,
                output_pointer,
                output_capacity,
            )
        },
    )?;
    Ok(())
}

fn execute_operation(
    caller: &mut Caller<'_, HostState>,
    operation: Operation,
    input_pointer: i32,
    input_length: i32,
    output_pointer: i32,
    output_capacity: i32,
) -> i32 {
    let result = (|| -> Result<Value> {
        let memory = guest_memory(caller)?;
        let input = read_guest_bytes(&memory, caller, input_pointer, input_length)?;
        let request: Value = serde_json::from_slice(&input).context("invalid operation JSON")?;
        perform_operation(&caller.data().connection, operation, &request)
    })();
    let response = match result {
        Ok(value) => value,
        Err(error) => {
            json!({ "ok": false, "error": "storage_failure", "diagnostic": error.to_string() })
        }
    };
    let bytes = match serde_json::to_vec(&response) {
        Ok(bytes) => bytes,
        Err(_) => return -1,
    };
    let Ok(memory) = guest_memory(caller) else {
        return -1;
    };
    if write_guest_bytes(&memory, caller, output_pointer, output_capacity, &bytes).is_err() {
        return -1;
    }
    i32::try_from(bytes.len()).unwrap_or(-1)
}

fn perform_operation(
    connection: &Connection,
    operation: Operation,
    value: &Value,
) -> Result<Value> {
    match operation {
        Operation::InsertUser => {
            let name = string(value, "name")?;
            let email = string(value, "email")?;
            let verified = value
                .get("verified")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = value
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("active");
            let result = connection.execute(
                "INSERT INTO users(name,email,verified,status) VALUES (?1,?2,?3,?4)",
                params![name, email, verified, status],
            );
            match result {
                Ok(_) => Ok(json!({ "ok": true, "id": connection.last_insert_rowid() })),
                Err(error) if is_constraint(&error) => {
                    Ok(json!({ "ok": false, "error": "duplicate_email" }))
                }
                Err(error) => Err(error.into()),
            }
        }
        Operation::GetUser => {
            let id = integer(value, "id")?;
            let record = connection
                .query_row(
                    "SELECT id,name,email,verified,status,suspension_reason,deleted_at,internal_metadata
                     FROM users WHERE id=?1",
                    [id],
                    |row| {
                        Ok(json!({
                            "id": row.get::<_, i64>(0)?,
                            "name": row.get::<_, String>(1)?,
                            "email": row.get::<_, String>(2)?,
                            "verified": row.get::<_, bool>(3)?,
                            "status": row.get::<_, String>(4)?,
                            "suspension_reason": row.get::<_, Option<String>>(5)?,
                            "deleted_at": row.get::<_, Option<String>>(6)?,
                            "internal_metadata": row.get::<_, String>(7)?,
                        }))
                    },
                )
                .optional()?;
            Ok(match record {
                Some(record) => json!({ "ok": true, "user": record }),
                None => json!({ "ok": false, "error": "not_found" }),
            })
        }
        Operation::UpdateName => {
            let changed = connection.execute(
                "UPDATE users SET name=?2 WHERE id=?1 AND deleted_at IS NULL",
                params![integer(value, "id")?, string(value, "name")?],
            )?;
            Ok(updated(changed))
        }
        Operation::UpdateEmail => {
            let result = connection.execute(
                "UPDATE users SET email=?2 WHERE id=?1 AND deleted_at IS NULL",
                params![integer(value, "id")?, string(value, "email")?],
            );
            match result {
                Ok(changed) => Ok(updated(changed)),
                Err(error) if is_constraint(&error) => {
                    Ok(json!({ "ok": false, "error": "duplicate_email" }))
                }
                Err(error) => Err(error.into()),
            }
        }
        Operation::AppendEmailAudit => {
            connection.execute(
                "INSERT INTO email_audit(user_id,old_email,new_email) VALUES (?1,?2,?3)",
                params![
                    integer(value, "user_id")?,
                    string(value, "old_email")?,
                    string(value, "new_email")?,
                ],
            )?;
            Ok(json!({ "ok": true }))
        }
        Operation::SoftDeleteUser => {
            let changed = connection.execute(
                "UPDATE users SET deleted_at='deleted' WHERE id=?1 AND deleted_at IS NULL",
                [integer(value, "id")?],
            )?;
            Ok(updated(changed))
        }
        Operation::UpdateStatus => {
            let changed = connection.execute(
                "UPDATE users SET status=?2,suspension_reason=?3 WHERE id=?1 AND deleted_at IS NULL",
                params![
                    integer(value, "id")?,
                    string(value, "status")?,
                    value.get("reason").and_then(Value::as_str),
                ],
            )?;
            Ok(updated(changed))
        }
        Operation::UpsertProfile => {
            connection.execute(
                "INSERT INTO profiles(user_id,timezone) VALUES (?1,?2)
                 ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone",
                params![integer(value, "user_id")?, string(value, "timezone")?],
            )?;
            Ok(json!({ "ok": true, "timezone": string(value, "timezone")? }))
        }
    }
}

fn updated(changed: usize) -> Value {
    if changed == 1 {
        json!({ "ok": true })
    } else {
        json!({ "ok": false, "error": "not_found" })
    }
}

fn is_constraint(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(inner, _) if inner.code == ErrorCode::ConstraintViolation)
}

fn string<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .with_context(|| format!("operation requires string field `{field}`"))
}

fn integer(value: &Value, field: &str) -> Result<i64> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .with_context(|| format!("operation requires integer field `{field}`"))
}

fn guest_memory(caller: &mut Caller<'_, HostState>) -> Result<Memory> {
    match caller.get_export("memory") {
        Some(Extern::Memory(memory)) => Ok(memory),
        _ => bail!("guest memory is unavailable"),
    }
}

fn read_guest_bytes(
    memory: &Memory,
    caller: &Caller<'_, HostState>,
    pointer: i32,
    length: i32,
) -> Result<Vec<u8>> {
    let start = usize::try_from(pointer).context("negative input pointer")?;
    let length = usize::try_from(length).context("negative input length")?;
    let end = start.checked_add(length).context("input range overflow")?;
    Ok(memory
        .data(caller)
        .get(start..end)
        .context("input range outside guest memory")?
        .to_vec())
}

fn write_guest_bytes(
    memory: &Memory,
    caller: &mut Caller<'_, HostState>,
    pointer: i32,
    capacity: i32,
    bytes: &[u8],
) -> Result<()> {
    let start = usize::try_from(pointer).context("negative output pointer")?;
    let capacity = usize::try_from(capacity).context("negative output capacity")?;
    if bytes.len() > capacity {
        bail!("operation response exceeds guest capacity");
    }
    memory.write(caller, start, bytes)?;
    Ok(())
}

fn handle_http(mut request: Request, runtime: &mut Runtime) -> Result<()> {
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take((BODY_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > BODY_LIMIT {
        return respond(request, 413, json!({ "error": "body_too_large" }));
    }
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => return respond(request, 400, json!({ "error": "invalid_json" })),
        }
    };
    let role = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("x-actor-role"))
        .map(|header| header.value.as_str())
        .unwrap_or("ordinary");
    let method = match request.method() {
        Method::Get => "GET",
        Method::Post => "POST",
        Method::Patch => "PATCH",
        Method::Delete => "DELETE",
        Method::Put => "PUT",
        _ => request.method().as_str(),
    };
    let envelope = serde_json::to_vec(&json!({
        "method": method,
        "path": request.url(),
        "actor_role": role,
        "body": body,
    }))?;
    let response = runtime.invoke(&envelope)?;
    let status = response
        .get("status")
        .and_then(Value::as_u64)
        .filter(|value| (100..=599).contains(value))
        .context("candidate response requires a valid status")? as u16;
    let body = response.get("body").cloned().unwrap_or(Value::Null);
    respond(request, status, body)
}

fn respond(request: Request, status: u16, body: Value) -> Result<()> {
    let bytes = serde_json::to_vec(&body)?;
    let response = Response::from_data(bytes)
        .with_status_code(StatusCode(status))
        .with_header(Header::from_bytes("content-type", "application/json").unwrap());
    request.respond(response)?;
    Ok(())
}

struct Runtime {
    store: Store<HostState>,
    memory: Memory,
    allocate: TypedFunc<i32, i32>,
    handle: TypedFunc<(i32, i32), i64>,
    deallocate: Option<TypedFunc<(i32, i32), ()>>,
    fuel_per_request: u64,
}

impl Runtime {
    fn invoke(&mut self, input: &[u8]) -> Result<Value> {
        self.store.set_fuel(self.fuel_per_request)?;
        let input_length = i32::try_from(input.len()).context("request is too large")?;
        let input_pointer = self.allocate.call(&mut self.store, input_length)?;
        self.memory
            .write(&mut self.store, usize::try_from(input_pointer)?, input)?;
        let packed = self
            .handle
            .call(&mut self.store, (input_pointer, input_length))? as u64;
        let output_pointer = (packed >> 32) as u32 as usize;
        let output_length = (packed & 0xffff_ffff) as u32 as usize;
        if output_length > RESPONSE_LIMIT {
            bail!("candidate response exceeds limit");
        }
        let output = self
            .memory
            .data(&self.store)
            .get(
                output_pointer
                    ..output_pointer
                        .checked_add(output_length)
                        .context("response overflow")?,
            )
            .context("candidate response outside memory")?
            .to_vec();
        if let Some(deallocate) = &self.deallocate {
            let _ = deallocate.call(&mut self.store, (input_pointer, input_length));
            let _ = deallocate.call(
                &mut self.store,
                (
                    i32::try_from(output_pointer)?,
                    i32::try_from(output_length)?,
                ),
            );
        }
        serde_json::from_slice(&output).context("candidate returned invalid response JSON")
    }
}

struct HostState {
    connection: Connection,
    limits: StoreLimits,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AllowedImport {
    module: String,
    name: String,
}

struct RuntimePolicy {
    allowed_imports: Vec<AllowedImport>,
    maximum_memory_bytes: usize,
    fuel_per_request: u64,
}

impl RuntimePolicy {
    fn load(file: &PathBuf) -> Result<Self> {
        let value: Value = serde_json::from_slice(&fs::read(file)?)
            .with_context(|| format!("invalid policy `{}`", file.display()))?;
        let imports = value
            .get("allowed_imports")
            .and_then(Value::as_array)
            .context("policy allowed_imports must be an array")?;
        let mut allowed_imports = Vec::new();
        for import in imports {
            let allowed = AllowedImport {
                module: string(import, "module")?.to_string(),
                name: string(import, "name")?.to_string(),
            };
            if !supported_import(&allowed) {
                bail!(
                    "unsupported policy import `{}.{}`",
                    allowed.module,
                    allowed.name
                );
            }
            if allowed_imports.contains(&allowed) {
                bail!(
                    "policy repeats import `{}.{}`",
                    allowed.module,
                    allowed.name
                );
            }
            allowed_imports.push(allowed);
        }
        allowed_imports
            .sort_by(|left, right| (&left.module, &left.name).cmp(&(&right.module, &right.name)));
        let resources = value.get("resources").and_then(Value::as_object);
        Ok(Self {
            allowed_imports,
            maximum_memory_bytes: resources
                .and_then(|value| value.get("guest_memory_bytes"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(DEFAULT_MEMORY_BYTES),
            fuel_per_request: resources
                .and_then(|value| value.get("fuel_per_request"))
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_FUEL),
        })
    }
}

fn supported_import(import: &AllowedImport) -> bool {
    matches!(
        (import.module.as_str(), import.name.as_str()),
        ("air_users_v1", "insert_user")
            | ("air_users_v1", "get_user")
            | ("air_users_v1", "update_name")
            | ("air_users_v1", "update_email")
            | ("air_audit_v1", "append_email_change")
            | ("air_users_v1", "soft_delete_user")
            | ("air_users_v1", "update_status")
            | ("air_profiles_v1", "upsert_profile")
    )
}

fn verify_module(module: &Module, policy: &RuntimePolicy) -> Result<()> {
    verify_exports(module)?;
    let mut imports = Vec::new();
    for import in module.imports() {
        let allowed = AllowedImport {
            module: import.module().to_string(),
            name: import.name().to_string(),
        };
        verify_operation_type(import.ty(), &allowed)?;
        imports.push(allowed);
    }
    imports.sort_by(|left, right| (&left.module, &left.name).cmp(&(&right.module, &right.name)));
    if imports != policy.allowed_imports {
        bail!("candidate imports do not equal the independent capability policy");
    }
    Ok(())
}

fn verify_operation_type(value: ExternType, import: &AllowedImport) -> Result<()> {
    if !supported_import(import) {
        bail!(
            "undeclared capability import `{}.{}`",
            import.module,
            import.name
        );
    }
    let ExternType::Func(function) = value else {
        bail!("capability import must be a function");
    };
    let parameters: Vec<_> = function.params().collect();
    let results: Vec<_> = function.results().collect();
    if parameters.len() != 4
        || !parameters.iter().all(|value| matches!(value, ValType::I32))
        || results.len() != 1
        || !matches!(results[0], ValType::I32)
    {
        bail!("capability import has an incompatible type");
    }
    Ok(())
}

fn verify_exports(module: &Module) -> Result<()> {
    let memory = module
        .exports()
        .find(|export| export.name() == "memory")
        .context("candidate does not export `memory`")?;
    if !matches!(memory.ty(), ExternType::Memory(_)) {
        bail!("candidate `memory` export is not linear memory");
    }
    verify_exported_function(module, "alloc", 1, false)?;
    verify_exported_function(module, "handle_request", 2, true)?;
    Ok(())
}

fn verify_exported_function(
    module: &Module,
    name: &str,
    parameter_count: usize,
    result_is_i64: bool,
) -> Result<()> {
    let export = module
        .exports()
        .find(|export| export.name() == name)
        .with_context(|| format!("candidate does not export `{name}`"))?;
    let ExternType::Func(function) = export.ty() else {
        bail!("candidate export `{name}` is not a function");
    };
    let parameters: Vec<_> = function.params().collect();
    let results: Vec<_> = function.results().collect();
    let result_matches = results.len() == 1
        && if result_is_i64 {
            matches!(results[0], ValType::I64)
        } else {
            matches!(results[0], ValType::I32)
        };
    if parameters.len() != parameter_count
        || !parameters.iter().all(|value| matches!(value, ValType::I32))
        || !result_matches
    {
        bail!("candidate export `{name}` has an incompatible type");
    }
    Ok(())
}

struct Options {
    wasm: PathBuf,
    policy: Option<PathBuf>,
    database: Option<PathBuf>,
    host: String,
    port: u16,
    max_requests: Option<u64>,
}

impl Options {
    fn parse(arguments: &[String]) -> Result<Self> {
        let mut wasm = None;
        let mut policy = None;
        let mut database = None;
        let mut host = "127.0.0.1".to_string();
        let mut port = 0;
        let mut max_requests = None;
        let mut index = 0;
        while index < arguments.len() {
            let flag = arguments[index].as_str();
            let value = arguments
                .get(index + 1)
                .with_context(|| format!("missing value for {flag}"))?;
            match flag {
                "--wasm" => wasm = Some(PathBuf::from(value)),
                "--policy" => policy = Some(PathBuf::from(value)),
                "--db" => database = Some(PathBuf::from(value)),
                "--host" => host = value.clone(),
                "--port" => port = value.parse().context("invalid --port")?,
                "--max-requests" => {
                    max_requests = Some(value.parse().context("invalid --max-requests")?)
                }
                _ => bail!("unknown option `{flag}`"),
            }
            index += 2;
        }
        Ok(Self {
            wasm: wasm.context("--wasm is required")?,
            policy,
            database,
            host,
            port,
            max_requests,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_only_flat_table_scoped_imports() {
        assert!(supported_import(&AllowedImport {
            module: "air_users_v1".to_string(),
            name: "insert_user".to_string(),
        }));
        assert!(!supported_import(&AllowedImport {
            module: "wasi_snapshot_preview1".to_string(),
            name: "path_open".to_string(),
        }));
    }

    #[test]
    fn initialises_the_complete_hidden_host_schema() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('users','email_audit','profiles')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 3);
    }
}
