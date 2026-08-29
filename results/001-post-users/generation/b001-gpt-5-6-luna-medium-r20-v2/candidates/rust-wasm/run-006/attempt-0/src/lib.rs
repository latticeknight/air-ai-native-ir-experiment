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

fn valid_name(ptr: i32, len: i32) -> bool {
    if len <= 0 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    core::str::from_utf8(bytes).is_ok()
}

fn valid_email(ptr: i32, len: i32) -> bool {
    if len < 5 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    let email = match core::str::from_utf8(bytes) {
        Ok(email) => email,
        Err(_) => return false,
    };

    if email.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let mut at_count = 0;
    let mut at_byte = 0;
    for (index, byte) in email.bytes().enumerate() {
        if byte == b'@' {
            at_count += 1;
            at_byte = index;
        }
    }
    if at_count != 1 || at_byte == 0 {
        return false;
    }

    let domain = &email[at_byte + 1..];
    let dot = match domain.find('.') {
        Some(index) => index,
        None => return false,
    };

    !domain[..dot].is_empty() && !domain[dot + 1..].is_empty()
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

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    if result > 0 {
        result
    } else {
        match result {
            -4 => -4,
            -1 => -1,
            -2 => -2,
            _ => -3,
        }
    }
}
