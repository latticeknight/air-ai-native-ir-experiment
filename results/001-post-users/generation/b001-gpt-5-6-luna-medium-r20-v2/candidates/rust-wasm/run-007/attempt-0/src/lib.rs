#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    loop {}
}

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

fn valid_email(email: &[u8]) -> bool {
    if email.len() < 5 || core::str::from_utf8(email).is_err() {
        return false;
    }

    let mut at = None;
    for (index, &byte) in email.iter().enumerate() {
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

    email[at + 1..]
        .iter()
        .enumerate()
        .any(|(offset, &byte)| {
            byte == b'.' && offset >= 1 && at + 1 + offset + 1 < email.len()
        })
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
    if email_len < 5 {
        return -2;
    }

    let name = unsafe { core::slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    if core::str::from_utf8(name).is_err() {
        return -1;
    }

    let email = unsafe { core::slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };
    if !valid_email(email) {
        return -2;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    if result > 0 {
        result
    } else if result == -1 || result == -2 || result == -4 {
        result
    } else {
        -3
    }
}
