#![no_std]

use core::panic::PanicInfo;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(
        name_ptr: i32,
        name_len: i32,
        email_ptr: i32,
        email_len: i32,
    ) -> i64;
}

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    loop {}
}

fn name_is_valid(ptr: i32, len: i32) -> bool {
    if ptr < 0 || len <= 0 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    core::str::from_utf8(bytes).is_ok()
}

fn email_is_valid(ptr: i32, len: i32) -> bool {
    if ptr < 0 || len < 5 {
        return false;
    }

    let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize) };
    if bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let text = match core::str::from_utf8(bytes) {
        Ok(text) => text,
        Err(_) => return false,
    };

    let mut at_count = 0usize;
    let mut at_position = 0usize;
    let mut character_position = 0usize;
    for character in text.chars() {
        if character == '@' {
            at_count += 1;
            at_position = character_position;
        }
        character_position += 1;
    }

    if at_count != 1 || at_position == 0 {
        return false;
    }

    let mut position = 0usize;
    for character in text.chars() {
        if position > at_position && character == '.' {
            if position > at_position + 1 && position + 1 < character_position {
                return true;
            }
        }
        position += 1;
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
    if !name_is_valid(name_ptr, name_len) {
        return -1;
    }
    if !email_is_valid(email_ptr, email_len) {
        return -2;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    if result > 0 {
        result
    } else if result == -4 {
        -4
    } else {
        -3
    }
}
