pub mod ast;
pub mod checker;
pub mod parser;
pub mod wasm;

use ast::Program;

pub fn parse_and_check(source: &str) -> Result<Program, String> {
    let program = parser::parse(source)?;
    checker::check(&program)?;
    Ok(program)
}

pub fn compile(source: &str) -> Result<Vec<u8>, String> {
    let program = parse_and_check(source)?;
    Ok(wasm::emit(&program))
}
