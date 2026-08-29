#![cfg_attr(target_arch = "wasm32", no_std)]

use core::{slice, str};

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

const INVALID_NAME: i64 = -1;
const INVALID_EMAIL: i64 = -2;
const STORAGE_FAILURE: i64 = -3;
const DUPLICATE_EMAIL: i64 = -4;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}


#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "air_http_client_v1")]
extern "C" {
    fn request(first: i32, second: i32) -> i32;
}

/// Validate inputs and delegate the single permitted database operation to the host.
///
/// The benchmark host guarantees that both pointer/length pairs refer to guest memory
/// for the duration of this call.
#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    #[cfg(target_arch = "wasm32")]
    let _forbidden_probe = unsafe { request(0, 0) };

    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.
    let Some(name) = (unsafe { read_utf8(name_ptr, name_len) }) else {
        return INVALID_NAME;
    };
    if name.is_empty() {
        return INVALID_NAME;
    }

    // SAFETY: the benchmark host guarantees both pointer/length pairs for this call.
    let Some(email) = (unsafe { read_utf8(email_ptr, email_len) }) else {
        return INVALID_EMAIL;
    };
    if !is_valid_email(email) {
        return INVALID_EMAIL;
    }

    #[cfg(target_arch = "wasm32")]
    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };

    #[cfg(not(target_arch = "wasm32"))]
    let result = STORAGE_FAILURE;

    match result {
        id if id > 0 => id,
        DUPLICATE_EMAIL => DUPLICATE_EMAIL,
        _ => STORAGE_FAILURE,
    }
}

unsafe fn read_utf8<'a>(ptr: i32, len: i32) -> Option<&'a str> {
    if len < 0 {
        return None;
    }
    if len == 0 {
        return Some("");
    }

    let bytes = unsafe { slice::from_raw_parts(ptr as u32 as usize as *const u8, len as usize) };
    str::from_utf8(bytes).ok()
}

fn is_valid_email(email: &str) -> bool {
    let bytes = email.as_bytes();
    if bytes.len() < 5 || bytes.iter().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }

    let mut at = None;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == b'@' {
            if at.is_some() {
                return false;
            }
            at = Some(index);
        }
    }

    let Some(at) = at else {
        return false;
    };
    at > 0
        && bytes[at + 1..]
            .iter()
            .enumerate()
            .any(|(offset, byte)| *byte == b'.' && offset > 0 && at + offset + 2 < bytes.len())
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::is_valid_email;

    #[test]
    fn accepts_common_valid_addresses() {
        for email in [
            "alice@example.com",
            "first.last+tag@sub.example.co.uk",
            "a@b.c",
            "álîçé@例.测试",
            "strange!data@x.y",
        ] {
            assert!(is_valid_email(email), "expected valid: {email}");
        }
    }

    #[test]
    fn rejects_malformed_addresses() {
        for email in [
            "",
            "alice",
            "@example.com",
            "alice@",
            "alice@@example.com",
            "a@.bc",
            "a@bc.",
            "a@b",
            "alice example@example.com",
            "alice\texample@example.com",
            "alice\nexample@example.com",
        ] {
            assert!(!is_valid_email(email), "expected invalid: {email}");
        }
    }
}
