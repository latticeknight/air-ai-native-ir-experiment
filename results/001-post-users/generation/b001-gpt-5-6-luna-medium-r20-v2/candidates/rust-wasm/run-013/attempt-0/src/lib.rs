#![no_std]

use core::panic::PanicInfo;

#[link(wasm_import_module = "air_sqlite_v1")]
unsafe extern "C" {
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

    let email = match core::str::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let mut at_position = None;
    for (position, character) in email.char_indices() {
        if character == '@' {
            if at_position.is_some() {
                return false;
            }
            at_position = Some(position);
        }
    }

    let at_position = match at_position {
        Some(position) if position != 0 => position,
        _ => return false,
    };

    let domain = &email[at_position + 1..];
    let mut has_character_before_dot = false;
    for (position, character) in domain.char_indices() {
        if character == '.' {
            if has_character_before_dot && domain[position + 1..].chars().next().is_some() {
                return true;
            }
        } else {
            has_character_before_dot = true;
        }
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
    if name_len < 0 || email_len < 0 {
        return -1;
    }

    let name = unsafe { core::slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    let email = unsafe { core::slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };

    if !valid_name(name) {
        return -1;
    }
    if !valid_email(email) {
        return -2;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}
