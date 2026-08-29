#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic_handler(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn valid_email(email: &[u8]) -> bool {
    if email.len() < 5 || str::from_utf8(email).is_err() {
        return false;
    }

    let mut at = None;
    let mut index = 0;
    while index < email.len() {
        let byte = email[index];

        if byte == b'@' {
            if at.is_some() || index == 0 {
                return false;
            }
            at = Some(index);
        }

        if matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c) {
            return false;
        }

        index += 1;
    }

    let at = match at {
        Some(position) => position,
        None => return false,
    };

    let mut dot = at + 1;
    while dot < email.len() {
        if email[dot] == b'.' {
            return dot > at + 1 && dot + 1 < email.len();
        }
        dot += 1;
    }

    false
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if name_ptr < 0 || name_len <= 0 {
        return -1;
    }

    if email_ptr < 0 || email_len < 0 {
        return -2;
    }

    let name_len = name_len as usize;
    let email_len = email_len as usize;
    let name = unsafe { slice::from_raw_parts(name_ptr as *const u8, name_len) };
    let email = unsafe { slice::from_raw_parts(email_ptr as *const u8, email_len) };

    if str::from_utf8(name).is_err() {
        return -1;
    }

    if !valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len as i32, email_ptr, email_len as i32) }
}
