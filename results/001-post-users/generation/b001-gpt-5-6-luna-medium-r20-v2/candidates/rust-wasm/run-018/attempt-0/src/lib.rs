#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

fn bytes<'a>(ptr: i32, len: i32) -> Option<&'a [u8]> {
    if ptr < 0 || len < 0 {
        return None;
    }

    // The host ABI guarantees that the supplied range is within guest memory.
    Some(unsafe { slice::from_raw_parts(ptr as *const u8, len as usize) })
}

fn valid_email(value: &[u8]) -> bool {
    if value.len() < 5 || value.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let text = match str::from_utf8(value) {
        Ok(text) => text,
        Err(_) => return false,
    };

    let mut at_count = 0;
    let mut at = None;
    for (index, character) in text.char_indices() {
        if character == '@' {
            at_count += 1;
            at = Some(index);
        }
    }

    let at = match at {
        Some(index) if at_count == 1 && index != 0 => index,
        _ => return false,
    };

    let domain = &text[at + 1..];
    let mut domain_characters = domain.char_indices();
    let first_domain = match domain_characters.next() {
        Some((_, character)) => character,
        None => return false,
    };
    if first_domain == '.' {
        return false;
    }

    let dot = match domain.find('.') {
        Some(index) => index,
        None => return false,
    };
    let suffix = &domain[dot + 1..];
    !suffix.is_empty() && suffix.chars().next().is_some()
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    let name = match bytes(name_ptr, name_len) {
        Some(value) if !value.is_empty() && str::from_utf8(value).is_ok() => value,
        _ => return -1,
    };

    let email = match bytes(email_ptr, email_len) {
        Some(value) if valid_email(value) => value,
        _ => return -2,
    };

    unsafe { insert_user(name.as_ptr() as i32, name.len() as i32, email.as_ptr() as i32, email.len() as i32) }
}
