use crate::ast::{Function, Program, ProgramBody, Statement};

const TYPE_SECTION: u8 = 1;
const IMPORT_SECTION: u8 = 2;
const FUNCTION_SECTION: u8 = 3;
const MEMORY_SECTION: u8 = 5;
const EXPORT_SECTION: u8 = 7;
const CODE_SECTION: u8 = 10;
const DATA_SECTION: u8 = 11;

pub fn emit(program: &Program) -> Vec<u8> {
    match &program.body {
        ProgramBody::Command(main) => emit_command(program, main),
        ProgramBody::UserService(_) => emit_user_service(program),
    }
}

fn emit_command(program: &Program, main: &Function) -> Vec<u8> {
    let mut module = b"\0asm\x01\0\0\0".to_vec();
    push_custom_section(&mut module, "air.meta", metadata(program).as_bytes());
    push_section(&mut module, TYPE_SECTION, command_types());
    push_section(&mut module, IMPORT_SECTION, command_imports());
    push_section(&mut module, FUNCTION_SECTION, command_functions());
    push_section(&mut module, MEMORY_SECTION, memory());
    push_section(&mut module, EXPORT_SECTION, command_exports());

    let strings: Vec<&str> = main
        .statements
        .iter()
        .filter_map(|statement| match statement {
            Statement::Print(value) => Some(value.as_str()),
            Statement::Return(_) => None,
        })
        .collect();
    let offsets = allocate_strings(&strings);
    push_section(
        &mut module,
        CODE_SECTION,
        command_code(main, &strings, &offsets),
    );
    push_section(&mut module, DATA_SECTION, data(&strings, &offsets));
    module
}

fn emit_user_service(program: &Program) -> Vec<u8> {
    let mut module = b"\0asm\x01\0\0\0".to_vec();
    push_custom_section(&mut module, "air.meta", metadata(program).as_bytes());
    push_section(&mut module, TYPE_SECTION, service_types());
    push_section(&mut module, IMPORT_SECTION, service_imports());
    push_section(&mut module, FUNCTION_SECTION, service_functions());
    push_section(&mut module, MEMORY_SECTION, memory());
    push_section(&mut module, EXPORT_SECTION, service_exports());
    push_section(&mut module, CODE_SECTION, service_code());
    module
}

fn service_types() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    section.push(0x60);
    u32_leb(4, &mut section);
    section.extend_from_slice(&[0x7f, 0x7f, 0x7f, 0x7f]);
    u32_leb(1, &mut section);
    section.push(0x7e);
    section
}

fn service_imports() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    name("air_sqlite_v1", &mut section);
    name("insert_user", &mut section);
    section.push(0x00);
    u32_leb(0, &mut section);
    section
}

fn service_functions() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    u32_leb(0, &mut section);
    section
}

fn service_exports() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(2, &mut section);
    name("memory", &mut section);
    section.push(0x02);
    u32_leb(0, &mut section);
    name("handle_create_user", &mut section);
    section.push(0x00);
    u32_leb(1, &mut section);
    section
}

fn service_code() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);

    let mut body = Vec::new();
    u32_leb(1, &mut body);
    u32_leb(3, &mut body);
    body.push(0x7f);

    local_get(1, &mut body);
    body.push(0x45);
    begin_if(&mut body);
    return_i64(-1, &mut body);
    end(&mut body);

    local_get(3, &mut body);
    i32_const(5, &mut body);
    body.push(0x49);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);

    i32_const(0, &mut body);
    local_set(4, &mut body);

    body.extend_from_slice(&[0x02, 0x40, 0x03, 0x40]);
    local_get(4, &mut body);
    local_get(3, &mut body);
    body.push(0x4f);
    body.push(0x0d);
    u32_leb(1, &mut body);

    load_email_byte(&mut body);
    i32_const(64, &mut body);
    body.push(0x46);
    begin_if(&mut body);
    local_get(5, &mut body);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);
    local_get(4, &mut body);
    body.push(0x45);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);
    local_get(4, &mut body);
    i32_const(1, &mut body);
    body.push(0x6a);
    local_set(5, &mut body);
    end(&mut body);

    load_email_byte(&mut body);
    i32_const(46, &mut body);
    body.push(0x46);
    local_get(5, &mut body);
    body.push(0x45);
    body.push(0x45);
    body.push(0x71);
    local_get(4, &mut body);
    local_get(5, &mut body);
    body.push(0x4b);
    body.push(0x71);
    local_get(4, &mut body);
    i32_const(1, &mut body);
    body.push(0x6a);
    local_get(3, &mut body);
    body.push(0x49);
    body.push(0x71);
    begin_if(&mut body);
    i32_const(1, &mut body);
    local_set(6, &mut body);
    end(&mut body);

    for whitespace in [32, 9, 10, 13] {
        load_email_byte(&mut body);
        i32_const(whitespace, &mut body);
        body.push(0x46);
    }
    body.push(0x72);
    body.push(0x72);
    body.push(0x72);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);

    local_get(4, &mut body);
    i32_const(1, &mut body);
    body.push(0x6a);
    local_set(4, &mut body);
    body.push(0x0c);
    u32_leb(0, &mut body);
    end(&mut body);
    end(&mut body);

    local_get(5, &mut body);
    body.push(0x45);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);
    local_get(6, &mut body);
    body.push(0x45);
    begin_if(&mut body);
    return_i64(-2, &mut body);
    end(&mut body);

    for index in 0..4 {
        local_get(index, &mut body);
    }
    body.push(0x10);
    u32_leb(0, &mut body);
    end(&mut body);

    u32_leb(body.len() as u32, &mut section);
    section.extend_from_slice(&body);
    section
}

fn load_email_byte(body: &mut Vec<u8>) {
    local_get(2, body);
    local_get(4, body);
    body.push(0x6a);
    body.push(0x2d);
    u32_leb(0, body);
    u32_leb(0, body);
}

fn local_get(index: u32, body: &mut Vec<u8>) {
    body.push(0x20);
    u32_leb(index, body);
}

fn local_set(index: u32, body: &mut Vec<u8>) {
    body.push(0x21);
    u32_leb(index, body);
}

fn i32_const(value: i32, body: &mut Vec<u8>) {
    body.push(0x41);
    i32_leb(value, body);
}

fn return_i64(value: i64, body: &mut Vec<u8>) {
    body.push(0x42);
    i64_leb(value, body);
    body.push(0x0f);
}

fn begin_if(body: &mut Vec<u8>) {
    body.extend_from_slice(&[0x04, 0x40]);
}

fn end(body: &mut Vec<u8>) {
    body.push(0x0b);
}

fn metadata(program: &Program) -> String {
    let capabilities = program
        .capabilities
        .iter()
        .map(|capability| capability.id.as_str())
        .collect::<Vec<_>>()
        .join(",");
    let kind = match &program.body {
        ProgramBody::Command(_) => "command",
        ProgramBody::UserService(_) => "http-service",
    };
    format!(
        "format=air-meta-v1\nprogram={}\nair-version={}\nkind={}\ncapabilities={}\n",
        program.name, program.version, kind, capabilities
    )
}

fn command_types() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(3, &mut section);

    section.push(0x60);
    u32_leb(4, &mut section);
    section.extend_from_slice(&[0x7f, 0x7f, 0x7f, 0x7f]);
    u32_leb(1, &mut section);
    section.push(0x7f);

    section.push(0x60);
    u32_leb(0, &mut section);
    u32_leb(1, &mut section);
    section.push(0x7f);

    section.push(0x60);
    u32_leb(0, &mut section);
    u32_leb(0, &mut section);
    section
}

fn command_imports() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    name("wasi_snapshot_preview1", &mut section);
    name("fd_write", &mut section);
    section.push(0x00);
    u32_leb(0, &mut section);
    section
}

fn command_functions() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(2, &mut section);
    u32_leb(1, &mut section);
    u32_leb(2, &mut section);
    section
}

fn memory() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    section.push(0x00);
    u32_leb(1, &mut section);
    section
}

fn command_exports() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(3, &mut section);
    name("memory", &mut section);
    section.push(0x02);
    u32_leb(0, &mut section);
    name("air_main", &mut section);
    section.push(0x00);
    u32_leb(1, &mut section);
    name("_start", &mut section);
    section.push(0x00);
    u32_leb(2, &mut section);
    section
}

fn command_code(main: &Function, strings: &[&str], offsets: &[u32]) -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(2, &mut section);

    let mut main_body = vec![0x00];
    let mut print_index = 0;
    for statement in &main.statements {
        match statement {
            Statement::Print(_) => {
                emit_print(
                    offsets[print_index],
                    strings[print_index].len() as u32,
                    &mut main_body,
                );
                print_index += 1;
            }
            Statement::Return(value) => {
                main_body.push(0x41);
                i32_leb(*value, &mut main_body);
            }
        }
    }
    main_body.push(0x0b);
    u32_leb(main_body.len() as u32, &mut section);
    section.extend_from_slice(&main_body);

    let start_body = vec![0x00, 0x10, 0x01, 0x1a, 0x0b];
    u32_leb(start_body.len() as u32, &mut section);
    section.extend_from_slice(&start_body);
    section
}

fn emit_print(offset: u32, length: u32, body: &mut Vec<u8>) {
    body.push(0x41);
    i32_leb(0, body);
    body.push(0x41);
    i32_leb(offset as i32, body);
    body.push(0x36);
    u32_leb(2, body);
    u32_leb(0, body);

    body.push(0x41);
    i32_leb(4, body);
    body.push(0x41);
    i32_leb(length as i32, body);
    body.push(0x36);
    u32_leb(2, body);
    u32_leb(0, body);

    for value in [1, 0, 1, 8] {
        body.push(0x41);
        i32_leb(value, body);
    }
    body.push(0x10);
    u32_leb(0, body);
    body.push(0x1a);
}

fn allocate_strings(strings: &[&str]) -> Vec<u32> {
    let mut next = 64_u32;
    strings
        .iter()
        .map(|value| {
            let offset = next;
            next += value.len() as u32;
            offset
        })
        .collect()
}

fn data(strings: &[&str], offsets: &[u32]) -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(strings.len() as u32, &mut section);
    for (value, offset) in strings.iter().zip(offsets) {
        u32_leb(0, &mut section);
        section.push(0x41);
        i32_leb(*offset as i32, &mut section);
        section.push(0x0b);
        u32_leb(value.len() as u32, &mut section);
        section.extend_from_slice(value.as_bytes());
    }
    section
}

fn push_custom_section(module: &mut Vec<u8>, section_name: &str, bytes: &[u8]) {
    let mut payload = Vec::new();
    name(section_name, &mut payload);
    payload.extend_from_slice(bytes);
    push_section(module, 0, payload);
}

fn push_section(module: &mut Vec<u8>, id: u8, payload: Vec<u8>) {
    module.push(id);
    u32_leb(payload.len() as u32, module);
    module.extend_from_slice(&payload);
}

fn name(value: &str, output: &mut Vec<u8>) {
    u32_leb(value.len() as u32, output);
    output.extend_from_slice(value.as_bytes());
}

fn u32_leb(mut value: u32, output: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        output.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn i32_leb(mut value: i32, output: &mut Vec<u8>) {
    loop {
        let byte = (value as u8) & 0x7f;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        output.push(if done { byte } else { byte | 0x80 });
        if done {
            break;
        }
    }
}

fn i64_leb(mut value: i64, output: &mut Vec<u8>) {
    loop {
        let byte = (value as u8) & 0x7f;
        value >>= 7;
        let done = (value == 0 && byte & 0x40 == 0) || (value == -1 && byte & 0x40 != 0);
        output.push(if done { byte } else { byte | 0x80 });
        if done {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CapabilityRequirement, Function, ProgramBody};

    #[test]
    fn emits_a_wasm_module_with_air_metadata() {
        let program = Program {
            version: "0.1".into(),
            name: "hello".into(),
            capabilities: vec![CapabilityRequirement {
                id: "wasi:stdout@1".into(),
                digest: "sha256:test".into(),
                signer: "air:foundation".into(),
            }],
            body: ProgramBody::Command(Function {
                effects: vec!["wasi:stdout@1".into()],
                statements: vec![Statement::Print("hello\n".into()), Statement::Return(0)],
            }),
        };
        let bytes = emit(&program);
        assert_eq!(&bytes[..8], b"\0asm\x01\0\0\0");
        assert!(bytes.windows(8).any(|window| window == b"air.meta"));
        assert!(bytes.windows(5).any(|window| window == b"hello"));
    }
}
