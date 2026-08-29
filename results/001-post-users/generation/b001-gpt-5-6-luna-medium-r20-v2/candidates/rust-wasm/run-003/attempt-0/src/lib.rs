#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    #[link_name = "insert_user"]
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn valid_name(ptr: i32, len: i32) -> bool {
    if len <= 0 {
        return false;
    }

    // The host supplies the pointers and lengths for the duration of the call.
    let bytes = unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) };
    str::from_utf8(bytes).is_ok()
}

fn valid_email(ptr: i32, len: i32) -> bool {
    if len < 5 {
        return false;
    }

    // The host supplies the pointers and lengths for the duration of the call.
    let bytes = unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) };
    if str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_index = None;
    for (index, &byte) in bytes.iter().enumerate() {
        if matches!(byte, b' ' | 0x09..=0x0d) {
            return false;
        }
        if byte == b'@' {
            if at_index.is_some() {
                return false;
            }
            at_index = Some(index);
        }
    }

    let at = match at_index {
        Some(index) if index > 0 => index,
        _ => return false,
    };

    // The dot must occur after the at-sign, with at least one character between
    // them, and it must not be the final character.
    bytes[at + 1..]
        .iter()
        .enumerate()
        .any(|(offset, &byte)| byte == b'.' && offset >= 1 && at + 1 + offset + 1 < bytes.len())
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if !valid_name(name_ptr, name_len) {
        return -1;
    }
    if !valid_email(email_ptr, email_len) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}
