#![no_std]

use core::panic::PanicInfo;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &PanicInfo<'_>) -> ! {
    loop {}
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && core::str::from_utf8(bytes).is_ok()
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let text = match core::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return false,
    };

    let mut at_count = 0u32;
    let mut at_seen = false;
    let mut chars_before_at = 0u32;
    let mut chars_after_at = 0u32;
    let mut dot_seen = false;
    let mut chars_after_dot = 0u32;

    for character in text.chars() {
        if character == '@' {
            at_count += 1;
            if at_count == 1 {
                if chars_before_at == 0 {
                    return false;
                }
                at_seen = true;
            }
            continue;
        }

        if !at_seen {
            chars_before_at += 1;
            continue;
        }

        if !dot_seen {
            if character == '.' {
                if chars_after_at == 0 {
                    return false;
                }
                dot_seen = true;
            } else {
                chars_after_at += 1;
            }
        } else {
            chars_after_dot += 1;
        }
    }

    at_count == 1 && dot_seen && chars_after_dot > 0
}

#[no_mangle]
pub unsafe extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    if name_len < 0 {
        return -1;
    }
    if email_len < 0 {
        return -2;
    }
    if name_len == 0 {
        return -1;
    }
    if email_len < 5 {
        return -2;
    }

    let name = core::slice::from_raw_parts(name_ptr as *const u8, name_len as usize);
    let email = core::slice::from_raw_parts(email_ptr as *const u8, email_len as usize);

    if !valid_name(name) {
        return -1;
    }
    if !valid_email(email) {
        return -2;
    }

    insert_user(name_ptr, name_len, email_ptr, email_len)
}
