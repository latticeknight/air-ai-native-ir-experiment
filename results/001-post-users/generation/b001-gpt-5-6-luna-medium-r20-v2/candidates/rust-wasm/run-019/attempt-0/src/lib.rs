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

fn input<'a>(ptr: i32, len: i32) -> Option<&'a [u8]> {
    if len < 0 || (len > 0 && ptr == 0) {
        return None;
    }

    // The host ABI guarantees that each supplied range is in exported memory.
    Some(unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) })
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && core::str::from_utf8(bytes).is_ok()
}

fn is_ascii_whitespace(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0b | 0x0c)
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().copied().any(is_ascii_whitespace) {
        return false;
    }

    let text = match core::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return false,
    };

    let mut at_count = 0u8;
    let mut at_seen = false;
    let mut chars_after_at = 0usize;
    let mut valid_dot = false;
    let mut chars_after_dot = 0usize;

    for character in text.chars() {
        if character == '@' {
            at_count = at_count.saturating_add(1);
            if at_count == 1 {
                at_seen = true;
            }
            continue;
        }

        if !at_seen {
            continue;
        }

        if character == '.' {
            if chars_after_at > 0 && !valid_dot {
                valid_dot = true;
            }
            continue;
        }

        if !valid_dot {
            chars_after_at += 1;
        } else {
            chars_after_dot += 1;
        }
    }

    at_count == 1 && !text.starts_with('@') && valid_dot && chars_after_dot > 0
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    let name = match input(name_ptr, name_len) {
        Some(bytes) if valid_name(bytes) => bytes,
        _ => return -1,
    };
    let email = match input(email_ptr, email_len) {
        Some(bytes) if valid_email(bytes) => bytes,
        _ => return -2,
    };

    unsafe { insert_user(name.as_ptr() as i32, name.len() as i32, email.as_ptr() as i32, email.len() as i32) }
}
