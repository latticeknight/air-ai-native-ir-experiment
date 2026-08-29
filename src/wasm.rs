use crate::ast::{Program, Statement};

const TYPE_SECTION: u8 = 1;
const IMPORT_SECTION: u8 = 2;
const FUNCTION_SECTION: u8 = 3;
const MEMORY_SECTION: u8 = 5;
const EXPORT_SECTION: u8 = 7;
const CODE_SECTION: u8 = 10;
const DATA_SECTION: u8 = 11;

pub fn emit(program: &Program) -> Vec<u8> {
    let mut module = b"\0asm\x01\0\0\0".to_vec();
    push_custom_section(&mut module, "air.meta", metadata(program).as_bytes());
    push_section(&mut module, TYPE_SECTION, types());
    push_section(&mut module, IMPORT_SECTION, imports());
    push_section(&mut module, FUNCTION_SECTION, functions());
    push_section(&mut module, MEMORY_SECTION, memory());
    push_section(&mut module, EXPORT_SECTION, exports());

    let strings: Vec<&str> = program
        .main
        .statements
        .iter()
        .filter_map(|statement| match statement {
            Statement::Print(value) => Some(value.as_str()),
            Statement::Return(_) => None,
        })
        .collect();
    let offsets = allocate_strings(&strings);
    push_section(&mut module, CODE_SECTION, code(program, &strings, &offsets));
    push_section(&mut module, DATA_SECTION, data(&strings, &offsets));
    module
}

fn metadata(program: &Program) -> String {
    let capabilities = program
        .capabilities
        .iter()
        .map(|capability| capability.id.as_str())
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "format=air-meta-v1\nprogram={}\nair-version={}\ncapabilities={}\n",
        program.name, program.version, capabilities
    )
}

fn types() -> Vec<u8> {
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

fn imports() -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(1, &mut section);
    name("wasi_snapshot_preview1", &mut section);
    name("fd_write", &mut section);
    section.push(0x00);
    u32_leb(0, &mut section);
    section
}

fn functions() -> Vec<u8> {
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

fn exports() -> Vec<u8> {
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

fn code(program: &Program, strings: &[&str], offsets: &[u32]) -> Vec<u8> {
    let mut section = Vec::new();
    u32_leb(2, &mut section);

    let mut main_body = vec![0x00];
    let mut print_index = 0;
    for statement in &program.main.statements {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CapabilityRequirement, Function};

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
            main: Function {
                effects: vec!["wasi:stdout@1".into()],
                statements: vec![Statement::Print("hello\n".into()), Statement::Return(0)],
            },
        };
        let bytes = emit(&program);
        assert_eq!(&bytes[..8], b"\0asm\x01\0\0\0");
        assert!(bytes.windows(8).any(|window| window == b"air.meta"));
        assert!(bytes.windows(5).any(|window| window == b"hello"));
    }
}
