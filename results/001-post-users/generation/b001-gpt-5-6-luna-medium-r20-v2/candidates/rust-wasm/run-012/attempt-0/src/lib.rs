#![no_std]

use core::panic::PanicInfo;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

fn is_valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && core::str::from_utf8(bytes).is_ok()
}

fn is_valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || core::str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_index = None;
    for (index, &byte) in bytes.iter().enumerate() {
        if byte.is_ascii_whitespace() {
            return false;
        }

        if byte == b'@' {
            if at_index.is_some() || index == 0 {
                return false;
            }
            at_index = Some(index);
        }
    }

    let at_index = match at_index {
        Some(index) => index,
        None => return false,
    };

    let domain = &bytes[at_index + 1..];
    let dot_index = match domain.iter().position(|&byte| byte == b'.') {
        Some(index) => index,
        None => return false,
    };

    dot_index > 0 && dot_index + 1 < domain.len()
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

    let name = unsafe { core::slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    let email = unsafe { core::slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };

    if !is_valid_name(name) {
        return -1;
    }
    if !is_valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}
