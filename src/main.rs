use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("air: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    if args.first().is_some_and(|command| command == "serve") {
        return serve(&args[1..]);
    }
    if args.first().is_some_and(|command| command == "benchmark") {
        return benchmark(&args[1..]);
    }
    match args.as_slice() {
        [command, input] if command == "check" => {
            let source = read(input)?;
            let program = air_lang::parse_and_check(&source)?;
            println!("checked {} (AIR {})", program.name, program.version);
            Ok(())
        }
        [command, input] if command == "compile" || command == "build" => {
            let output = default_output(input);
            compile_to(input, &output)?;
            println!("wrote {}", output.display());
            Ok(())
        }
        [command, input, flag, output]
            if (command == "compile" || command == "build") && flag == "-o" =>
        {
            let output = PathBuf::from(output);
            compile_to(input, &output)?;
            println!("wrote {}", output.display());
            Ok(())
        }
        [command, input] if command == "run" => run_wasmtime(input, None),
        [command, input] if command == "test" => test_program(input),
        [command, input, flag, runtime] if command == "run" && flag == "--wasmtime" => {
            run_wasmtime(input, Some(runtime))
        }
        _ => Err(usage().to_string()),
    }
}

fn test_program(input: &str) -> Result<(), String> {
    let source = read(input)?;
    let program = air_lang::parse_and_check(&source)?;
    if !matches!(program.body, air_lang::ast::ProgramBody::UserService(_)) {
        return Err("`air test` currently supports the POST /users service slice".into());
    }
    let output = default_output(input);
    compile_to(input, &output)?;
    let test = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/service-e2e.mjs");
    run_node_script(&test, [output.as_os_str()])
}

fn benchmark(args: &[String]) -> Result<(), String> {
    let runner = Path::new(env!("CARGO_MANIFEST_DIR")).join("benchmarks/run-air-trial.mjs");
    run_node_script(&runner, args.iter().map(String::as_str))
}

fn run_node_script<I, S>(script: &Path, args: I) -> Result<(), String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let node = env::var("AIR_NODE").unwrap_or_else(|_| "node".to_string());
    let status = Command::new(&node)
        .arg("--disable-warning=ExperimentalWarning")
        .arg(script)
        .args(args)
        .status()
        .map_err(|error| format!("could not start `{node}`: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Node process exited with status {status}"))
    }
}

fn compile_to(input: &str, output: &Path) -> Result<(), String> {
    let source = read(input)?;
    let bytes = air_lang::compile(&source)?;
    if let Some(parent) = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create `{}`: {error}", parent.display()))?;
    }
    fs::write(output, bytes)
        .map_err(|error| format!("could not write `{}`: {error}", output.display()))
}

fn run_wasmtime(input: &str, explicit_runtime: Option<&String>) -> Result<(), String> {
    let source = read(input)?;
    let program = air_lang::parse_and_check(&source)?;
    if !matches!(program.body, air_lang::ast::ProgramBody::Command(_)) {
        return Err("HTTP services run through `air serve`, not the WASI command runner".into());
    }
    let output = default_output(input);
    compile_to(input, &output)?;
    let runtime = explicit_runtime
        .cloned()
        .or_else(|| env::var("AIR_WASMTIME").ok())
        .unwrap_or_else(|| "wasmtime".to_string());
    let status = Command::new(&runtime).arg(&output).status().map_err(|error| {
        format!(
            "could not start Wasmtime at `{runtime}`: {error}. Install Wasmtime or pass `--wasmtime /path/to/wasmtime`"
        )
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Wasmtime exited with status {status}"))
    }
}

fn serve(args: &[String]) -> Result<(), String> {
    let input = args.first().ok_or_else(|| usage().to_string())?;
    let mut database = "target/air/users.sqlite".to_string();
    let mut port = "3000".to_string();
    let mut cursor = 1;
    while cursor < args.len() {
        let flag = &args[cursor];
        let value = args
            .get(cursor + 1)
            .ok_or_else(|| format!("missing value for `{flag}`"))?;
        match flag.as_str() {
            "--db" => database = value.clone(),
            "--port" => {
                let parsed = value
                    .parse::<u16>()
                    .map_err(|_| "--port must be an integer from 0 to 65535".to_string())?;
                port = parsed.to_string();
            }
            _ => return Err(format!("unknown serve option `{flag}`")),
        }
        cursor += 2;
    }

    let source = read(input)?;
    let program = air_lang::parse_and_check(&source)?;
    if !matches!(program.body, air_lang::ast::ProgramBody::UserService(_)) {
        return Err("`air serve` requires an AIR HTTP service".into());
    }
    let output = default_output(input);
    compile_to(input, &output)?;

    let runtime = Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime/http-sqlite-host.mjs");
    let node = env::var("AIR_NODE").unwrap_or_else(|_| "node".to_string());
    let status = Command::new(&node)
        .arg("--disable-warning=ExperimentalWarning")
        .arg(runtime)
        .arg("--wasm")
        .arg(output)
        .arg("--db")
        .arg(database)
        .arg("--port")
        .arg(port)
        .status()
        .map_err(|error| {
            format!("could not start the AIR reference host with `{node}`: {error}")
        })?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("AIR reference host exited with status {status}"))
    }
}

fn read(input: &str) -> Result<String, String> {
    fs::read_to_string(input).map_err(|error| format!("could not read `{input}`: {error}"))
}

fn default_output(input: &str) -> PathBuf {
    let input = Path::new(input);
    let stem = input.file_stem().unwrap_or_default();
    Path::new("target")
        .join("air")
        .join(stem)
        .with_extension("wasm")
}

fn usage() -> &'static str {
    "usage:\n  air check <program.air>\n  air build <program.air> [-o output.wasm]\n  air compile <program.air> [-o output.wasm]\n  air run <program.air> [--wasmtime /path/to/wasmtime]\n  air serve <service.air> [--db users.sqlite] [--port 3000]\n  air test <service.air>\n  air benchmark --trial-id ID --generated-tokens N --repair-tokens N --model-calls N --repair-iterations N"
}
