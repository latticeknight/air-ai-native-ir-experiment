#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn input_bytes(ptr: i32, len: i32) -> Option<&'static [u8]> {
    if len < 0 {
        return None;
    }

    let len = len as usize;
    if len == 0 {
        return Some(&[]);
    }
    if ptr == 0 {
        return None;
    }

    // The host keeps the supplied buffers alive for the duration of this call.
    Some(unsafe { slice::from_raw_parts(ptr as *const u8, len) })
}

fn valid_name(bytes: &[u8]) -> bool {
    !bytes.is_empty() && str::from_utf8(bytes).is_ok()
}

fn is_ascii_whitespace(byte: u8) -> bool {
    matches!(byte, b'\t'..=b'\r' | b' ')
}

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().copied().any(is_ascii_whitespace) {
        return false;
    }

    let email = match str::from_utf8(bytes) {
        Ok(email) => email,
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
    domain.char_indices().any(|(position, character)| {
        character == '.'
            && position != 0
            && domain[position + 1..].chars().next().is_some()
    })
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    let name = match input_bytes(name_ptr, name_len) {
        Some(name) if valid_name(name) => name,
        _ => return -1,
    };
    let email = match input_bytes(email_ptr, email_len) {
        Some(email) if valid_email(email) => email,
        _ => return -2,
    };

    unsafe { insert_user(name.as_ptr() as i32, name.len() as i32, email.as_ptr() as i32, email.len() as i32) }
}
