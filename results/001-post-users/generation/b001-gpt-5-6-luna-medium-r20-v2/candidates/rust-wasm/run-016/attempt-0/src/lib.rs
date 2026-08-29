#![no_std]

#[link(wasm_import_module = "air_sqlite_v1")]
extern "C" {
    fn insert_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64;
}

const INVALID_NAME: i64 = -1;
const INVALID_EMAIL: i64 = -2;
const STORAGE_FAILURE: i64 = -3;
const DUPLICATE_EMAIL: i64 = -4;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

fn bytes<'a>(ptr: i32, len: i32) -> Option<&'a [u8]> {
    if ptr < 0 || len < 0 {
        return None;
    }

    let ptr = ptr as usize;
    let len = len as usize;

    if len != 0 && ptr == 0 {
        return None;
    }

    // The host owns the memory and keeps these bytes alive for the call.
    let slice_ptr = if len == 0 {
        core::ptr::NonNull::<u8>::dangling().as_ptr()
    } else {
        ptr as *const u8
    };
    Some(unsafe { core::slice::from_raw_parts(slice_ptr, len) })
}

fn valid_name(name: &[u8]) -> bool {
    !name.is_empty() && core::str::from_utf8(name).is_ok()
}

fn valid_email(email: &[u8]) -> bool {
    if email.len() < 5 || core::str::from_utf8(email).is_err() {
        return false;
    }

    let mut at_count = 0usize;
    let mut at_index = 0usize;

    for (index, byte) in email.iter().copied().enumerate() {
        if byte.is_ascii_whitespace() {
            return false;
        }
        if byte == b'@' {
            at_count += 1;
            at_index = index;
        }
    }

    if at_count != 1 || at_index == 0 {
        return false;
    }

    let domain = &email[at_index + 1..];
    let Some(dot_index) = domain.iter().position(|&byte| byte == b'.') else {
        return false;
    };

    dot_index > 0 && dot_index + 1 < domain.len()
}

#[no_mangle]
pub extern "C" fn handle_create_user(
    name_ptr: i32,
    name_len: i32,
    email_ptr: i32,
    email_len: i32,
) -> i64 {
    let Some(name) = bytes(name_ptr, name_len) else {
        return INVALID_NAME;
    };
    let Some(email) = bytes(email_ptr, email_len) else {
        return INVALID_EMAIL;
    };

    if !valid_name(name) {
        return INVALID_NAME;
    }
    if !valid_email(email) {
        return INVALID_EMAIL;
    }

    let result = unsafe { insert_user(name_ptr, name_len, email_ptr, email_len) };
    match result {
        id if id > 0 => id,
        DUPLICATE_EMAIL => DUPLICATE_EMAIL,
        INVALID_NAME => INVALID_NAME,
        INVALID_EMAIL => INVALID_EMAIL,
        _ => STORAGE_FAILURE,
    }
}
