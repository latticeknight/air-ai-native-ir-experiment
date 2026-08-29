#![no_std]

use core::panic::PanicInfo;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

fn input_bytes(ptr: i32, len: i32) -> Option<&'static [u8]> {
    if ptr < 0 || len <= 0 {
        return None;
    }

    let length = len as usize;
    let address = ptr as usize;
    let end = address.checked_add(length)?;

    // The host owns the input memory for the duration of the call. The
    // checked range prevents integer wraparound before constructing the view.
    if end < address {
        return None;
    }

    Some(unsafe { core::slice::from_raw_parts(ptr as *const u8, length) })
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

    if core::str::from_utf8(bytes).is_err() {
        return false;
    }

    let mut at_count = 0usize;
    let mut at_position = 0usize;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == b'@' {
            at_count += 1;
            at_position = index;
        }
    }
    if at_count != 1 || at_position == 0 {
        return false;
    }

    let domain = &bytes[at_position + 1..];
    let Some(dot_position) = domain.iter().position(|&byte| byte == b'.') else {
        return false;
    };

    dot_position > 0 && dot_position + 1 < domain.len()
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
    if !valid_name(name) {
        return -1;
    }

    let Some(email) = input_bytes(email_ptr, email_len) else {
        return -2;
    };
    if !valid_email(email) {
        return -2;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    match result {
        id if id > 0 => id,
        -4 => -4,
        -1 => -1,
        -2 => -2,
        -3 => -3,
        _ => -3,
    }
}
