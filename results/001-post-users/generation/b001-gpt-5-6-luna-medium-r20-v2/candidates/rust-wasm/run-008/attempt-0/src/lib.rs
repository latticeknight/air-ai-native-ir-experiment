#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_count = 0usize;
    let mut at_position = 0usize;
    let mut has_domain_dot = false;

    for (position, &byte) in bytes.iter().enumerate() {
        if matches!(byte, b' ' | b'\t' | b'\n' | b'\x0b' | b'\x0c' | b'\r') {
            return false;
        }

        if byte == b'@' {
            at_count += 1;
            at_position = position;
        }
    }

    if at_count != 1 || at_position == 0 {
        return false;
    }

    for position in (at_position + 1)..bytes.len() {
        if bytes[position] == b'.'
            && position > at_position + 1
            && position + 1 < bytes.len()
        {
            has_domain_dot = true;
            break;
        }
    }

    has_domain_dot
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if name_len <= 0 {
        return -1;
    }
    if email_len <= 0 {
        return -2;
    }

    let name = unsafe { slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    if str::from_utf8(name).is_err() {
        return -1;
    }

    let email = unsafe { slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };
    if !valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
