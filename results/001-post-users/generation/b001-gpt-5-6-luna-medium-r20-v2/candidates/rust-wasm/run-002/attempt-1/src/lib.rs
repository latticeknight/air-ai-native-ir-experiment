#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

const INVALID_NAME: i64 = -1;
const INVALID_EMAIL: i64 = -2;

fn valid_name(ptr: i32, len: i32) -> bool {
    if ptr < 0 || len <= 0 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    core::str::from_utf8(bytes).is_ok()
}

fn valid_email(ptr: i32, len: i32) -> bool {
    if ptr < 0 || len < 5 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    if core::str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_index = None;
    for (index, &byte) in bytes.iter().enumerate() {
        if byte <= 0x7f && byte.is_ascii_whitespace() {
            return false;
        }
        if byte == b'@' {
            if at_index.is_some() || index == 0 {
                return false;
            }
            at_index = Some(index);
        }
    }

    let at = match at_index {
        Some(index) => index,
        None => return false,
    };

    let domain = &bytes[at + 1..];
    let dot = match domain.iter().position(|&byte| byte == b'.') {
        Some(index) => index,
        None => return false,
    };

    dot > 0 && dot + 1 < domain.len()
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if !valid_name(name_ptr, name_len) {
        return INVALID_NAME;
    }
    if !valid_email(email_ptr, email_len) {
        return INVALID_EMAIL;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}
