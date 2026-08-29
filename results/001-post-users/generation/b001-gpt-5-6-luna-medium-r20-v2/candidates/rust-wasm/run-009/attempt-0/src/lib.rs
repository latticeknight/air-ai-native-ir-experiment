#![no_std]

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    #[link_name = "insert_user"]
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && core::str::from_utf8(bytes).is_ok()
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    if core::str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_index = None;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'@' {
            if at_index.is_some() {
                return false;
            }
            at_index = Some(index);
        }
    }

    let Some(at_index) = at_index else {
        return false;
    };
    if at_index == 0 {
        return false;
    }

    let Some(dot_offset) = bytes[at_index + 1..].iter().position(|byte| *byte == b'.') else {
        return false;
    };
    let dot_index = at_index + 1 + dot_offset;
    dot_index <= at_index + 1 || dot_index + 1 >= bytes.len() {
        return false;
    }

    true
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if name_len <= 0 || email_len < 0 || name_ptr < 0 || email_ptr < 0 {
        return if name_len <= 0 || name_ptr < 0 {
            -1
        } else {
            -2
        };
    }

    let name = unsafe { core::slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    if !valid_name(name) {
        return -1;
    }

    let email = unsafe { core::slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };
    if !valid_email(email) {
        return -2;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    match result {
        id if id > 0 => id,
        -1 => -1,
        -2 => -2,
        -4 => -4,
        _ => -3,
    }
}
