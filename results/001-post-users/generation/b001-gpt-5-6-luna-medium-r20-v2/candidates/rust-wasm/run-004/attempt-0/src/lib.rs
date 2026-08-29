#![no_std]

use core::slice;
use core::str;

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

const INVALID_NAME: i64 = -1;
const INVALID_EMAIL: i64 = -2;

fn valid_email(bytes: &[u8]) -> bool {
    if bytes.len() < 5 || bytes.iter().any(|byte| matches!(*byte, 0x09..=0x0d | 0x20)) {
        return false;
    }

    let Ok(email) = str::from_utf8(bytes) else {
        return false;
    };

    let mut at_index = None;
    let mut at_count = 0usize;
    for (index, character) in email.char_indices() {
        if character == '@' {
            at_count += 1;
            if at_index.is_none() {
                at_index = Some(index);
            }
        }
    }

    let Some(at_index) = at_index else {
        return false;
    };
    if at_count != 1 || at_index == 0 {
        return false;
    }

    let mut characters_after_at = 0usize;
    for (index, character) in email.char_indices() {
        if index <= at_index {
            continue;
        }

        if character == '.' {
            if characters_after_at > 0 && index + character.len_utf8() < email.len() {
                return true;
            }
        } else {
            characters_after_at += 1;
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
    if name_len <= 0 || name_ptr < 0 {
        return INVALID_NAME;
    }
    if email_len < 0 || email_ptr < 0 {
        return INVALID_EMAIL;
    }

    // The host ABI guarantees that both ranges are within the exported memory.
    let name = unsafe { slice::from_raw_parts(name_ptr as *const u8, name_len as usize) };
    let email = unsafe { slice::from_raw_parts(email_ptr as *const u8, email_len as usize) };

    if str::from_utf8(name).is_err() {
        return INVALID_NAME;
    }
    if !valid_email(email) {
        return INVALID_EMAIL;
    }

    unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
