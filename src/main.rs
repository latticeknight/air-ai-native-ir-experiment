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
    match args.as_slice() {
        [command, input] if command == "check" => {
            let source = read(input)?;
            let program = air_lang::parse_and_check(&source)?;
            println!("checked {} (AIR {})", program.name, program.version);
            Ok(())
        }
        [command, input] if command == "compile" => {
            let output = default_output(input);
            compile_to(input, &output)?;
            println!("wrote {}", output.display());
            Ok(())
        }
        [command, input, flag, output] if command == "compile" && flag == "-o" => {
            let output = PathBuf::from(output);
            compile_to(input, &output)?;
            println!("wrote {}", output.display());
            Ok(())
        }
        [command, input] if command == "run" => run_wasmtime(input, None),
        [command, input, flag, runtime] if command == "run" && flag == "--wasmtime" => {
            run_wasmtime(input, Some(runtime))
        }
        _ => Err(usage().to_string()),
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
    "usage:\n  air check <program.air>\n  air compile <program.air> [-o output.wasm]\n  air run <program.air> [--wasmtime /path/to/wasmtime]"
}
