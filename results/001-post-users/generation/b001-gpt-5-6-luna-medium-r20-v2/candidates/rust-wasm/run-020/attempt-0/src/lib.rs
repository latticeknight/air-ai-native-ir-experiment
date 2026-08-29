#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

const INVALID_NAME: i64 = -1;
const INVALID_EMAIL: i64 = -2;
const STORAGE_FAILURE: i64 = -3;
const DUPLICATE_EMAIL: i64 = -4;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && str::from_utf8(bytes).is_ok()
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at = None;
    for (index, &byte) in bytes.iter().enumerate() {
        if byte.is_ascii_whitespace() {
            return false;
        }
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
    if name_len < 0 || email_len < 0 {
        return INVALID_NAME;
    }
    if name_len == 0 {
        return INVALID_NAME;
    }
    if email_len == 0 {
        return INVALID_EMAIL;
    }

    // The host owns these ranges and keeps them valid for the duration of this call.
    let name = unsafe { slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    let email = unsafe { slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };

    if !valid_name(name) {
        return INVALID_NAME;
    }
    if !valid_email(email) {
        return INVALID_EMAIL;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    match result {
        id if id > 0 => id,
        DUPLICATE_EMAIL => DUPLICATE_EMAIL,
        STORAGE_FAILURE => STORAGE_FAILURE,
        _ => STORAGE_FAILURE,
    }
}
