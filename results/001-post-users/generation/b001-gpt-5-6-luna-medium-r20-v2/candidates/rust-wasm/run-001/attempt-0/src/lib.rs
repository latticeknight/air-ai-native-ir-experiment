#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn input_bytes(ptr: i32, len: i32) -> Option<&'static [u8]> {
    if ptr < 0 || len < 0 {
        return None;
    }

    // The host owns the input for the duration of the call. The ABI guarantees
    // that the supplied range is within exported memory.
    Some(unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) })
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && str::from_utf8(bytes).is_ok()
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }
    if str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_position = None;
    for (position, byte) in bytes.iter().copied().enumerate() {
        if byte == b'@' {
            if at_position.is_some() {
                return false;
            }
            at_position = Some(position);
        }
    }

    let Some(at) = at_position else {
        return false;
    };
    if at == 0 {
        return false;
    }

    let Some(dot_offset) = bytes[at + 1..].iter().position(|byte| *byte == b'.') else {
        return false;
    };
    let dot = at + 1 + dot_offset;
    dot > at + 1 && dot + 1 < bytes.len()
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    let Some(name) = input_bytes(name_ptr, name_len) else {
        return -1;
    };
    let Some(email) = input_bytes(email_ptr, email_len) else {
        return -2;
    };

    if !valid_name(name) {
        return -1;
    }
    if !valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}
