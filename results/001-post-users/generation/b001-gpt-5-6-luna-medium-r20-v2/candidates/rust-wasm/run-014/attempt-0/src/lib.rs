#![no_std]

use core::slice;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}

fn is_ascii_whitespace(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r' | b' ')
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().any(|&byte| is_ascii_whitespace(byte)) {
        return false;
    }

    let mut at = None;
    for (index, &byte) in bytes.iter().enumerate() {
        if byte == b'@' {
            if at.is_some() || index == 0 {
                return false;
            }
            at = Some(index);
        }
    }

    let at = match at {
        Some(index) => index,
        None => return false,
    };

    let dot = match bytes[at + 1..].iter().position(|&byte| byte == b'.') {
        Some(offset) => at + 1 + offset,
        None => return false,
    };

    dot > at + 1 && dot + 1 < bytes.len()
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if name_len <= 0 || email_len < 0 {
        return if name_len <= 0 { -1 } else { -2 };
    }

    let name = unsafe { slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    let email = unsafe { slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };

    if core::str::from_utf8(name).is_err() {
        return -1;
    }
    if core::str::from_utf8(email).is_err() || !valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}
