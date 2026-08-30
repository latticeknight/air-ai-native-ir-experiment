#![no_std]

extern crate alloc;

use alloc::alloc::{Layout, alloc as allocate_bytes, dealloc as deallocate_bytes};
use alloc::string::String;
use alloc::vec;
use core::slice;

use serde::Deserialize;
use serde_json::{Value, json};

const OPERATION_BUFFER: usize = 65_536;

#[global_allocator]
static ALLOCATOR: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
#[cfg(not(test))]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    fn get_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn insert_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn soft_delete_user(
        input_ptr: i32,
        input_len: i32,
        output_ptr: i32,
        output_capacity: i32,
    ) -> i32;
    fn update_name(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    #[link_name = "update_status"]
    fn update_status_host(
        input_ptr: i32,
        input_len: i32,
        output_ptr: i32,
        output_capacity: i32,
    ) -> i32;
}

#[derive(Deserialize)]
struct Request {
    method: String,
    path: String,
    #[allow(dead_code)]
    actor_role: String,
    body: Value,
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(length: i32) -> i32 {
    let Ok(length) = usize::try_from(length) else {
        return 0;
    };
    allocate(length).map_or(0, |pointer| pointer as i32)
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(pointer: i32, length: i32) {
    let (Ok(pointer), Ok(length)) = (usize::try_from(pointer), usize::try_from(length)) else {
        return;
    };
    if let Ok(layout) = Layout::array::<u8>(length.max(1)) {
        unsafe { deallocate_bytes(pointer as *mut u8, layout) };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn handle_request(pointer: i32, length: i32) -> i64 {
    let request = read_request(pointer, length);
    let response = match request {
        Some(request) => dispatch(request),
        None => response(400, json!({ "error": "invalid_json" })),
    };
    emit(&response)
}

fn dispatch(request: Request) -> Value {
    if request.method == "GET" {
        return lookup_user(&request.path);
    }
    if request.method == "PATCH" {
        return update_user(&request.path, &request.body, &request.actor_role);
    }
    if request.method == "DELETE" {
        return delete_user(&request.path, &request.actor_role);
    }
    if request.method != "POST" || request.path != "/users" {
        return response(404, json!({ "error": "not_found" }));
    }
    let Some(body) = request.body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 2 || !body.contains_key("name") || !body.contains_key("email") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(name) = body.get("name").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    let Some(email) = body.get("email").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !valid_name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }
    if !valid_email(email) {
        return response(400, json!({ "error": "invalid_email" }));
    }
    let stored = call_operation(
        insert_user,
        &json!({ "name": name, "email": email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(201, json!({ "id": stored["id"], "verified": false }))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user(path: &str, body: &Value, _actor_role: &str) -> Value {
    if path.ends_with("/status") {
        return update_user_status(path, body, _actor_role);
    }
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 {
        return response(400, json!({ "error": "invalid_json" }));
    }

    if let Some(name) = body.get("name").and_then(Value::as_str) {
        if !valid_name(name) {
            return response(400, json!({ "error": "invalid_name" }));
        }

        let current = call_operation(get_user, &json!({ "id": id }));
        if is_suspended_user(&current) {
            return response(409, json!({ "error": "user_suspended" }));
        }

        let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
        return update_result(&stored);
    }

    response(400, json!({ "error": "invalid_json" }))
}

fn update_user_status(path: &str, body: &Value, actor_role: &str) -> Value {
    let Some(user_path) = path.strip_suffix("/status") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(id) = user_id(user_path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    if actor_role != "administrator" {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 2 {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_json" }));
    }

    let Some(reason) = body
        .get("reason")
        .and_then(Value::as_str)
        .filter(|reason| !reason.is_empty())
    else {
        return response(400, json!({ "error": "invalid_json" }));
    };

    let stored = call_operation(
        update_status_host,
        &json!({ "id": id, "status": status, "reason": reason }),
    );
    update_result(&stored)
}

fn update_result(stored: &Value) -> Value {
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "ok": true }))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn delete_user(path: &str, actor_role: &str) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    if actor_role != "administrator" {
        return response(403, json!({ "error": "forbidden" }));
    }

    let stored = call_operation(soft_delete_user, &json!({ "id": id }));
    update_result(&stored)
}

fn lookup_user(path: &str) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };

    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        let Some(user) = stored.get("user").and_then(Value::as_object) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        if is_deleted_user(&stored, user) {
            return response(404, json!({ "error": "not_found" }));
        }
        return response(200, public_user(user));
    }
    if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn user_id(path: &str) -> Option<u64> {
    path.strip_prefix("/users/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
}

fn public_user(user: &serde_json::Map<String, Value>) -> Value {
    json!({
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "verified": user.get("verified"),
        "status": user.get("status").cloned().unwrap_or_else(|| json!("active"))
    })
}

fn is_suspended_user(stored: &Value) -> bool {
    stored
        .get("user")
        .and_then(Value::as_object)
        .and_then(|user| user.get("status"))
        .and_then(Value::as_str)
        == Some("suspended")
}

fn is_deleted_user(stored: &Value, user: &serde_json::Map<String, Value>) -> bool {
    is_deleted_record(user) || is_deleted_record(stored.as_object().unwrap_or(user))
}

fn is_deleted_record(record: &serde_json::Map<String, Value>) -> bool {
    record.get("deleted").and_then(Value::as_bool) == Some(true)
        || record.get("is_deleted").and_then(Value::as_bool) == Some(true)
        || record.get("status").and_then(Value::as_str) == Some("deleted")
        || record
            .get("deleted_at")
            .is_some_and(|value| !value.is_null())
}

fn valid_name(value: &str) -> bool {
    let length = value.chars().count();
    (1..=100).contains(&length)
}

fn valid_email(value: &str) -> bool {
    if value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return false;
    }
    let mut parts = value.split('@');
    let Some(local) = parts.next() else {
        return false;
    };
    let Some(domain) = parts.next() else {
        return false;
    };
    if parts.next().is_some() || local.is_empty() || domain.is_empty() {
        return false;
    }
    if domain.starts_with('.') || domain.ends_with('.') || !domain.contains('.') {
        return false;
    }
    !domain.split('.').any(str::is_empty)
}

fn valid_status(value: &str) -> bool {
    matches!(value, "active" | "suspended")
}

type Operation = unsafe extern "C" fn(i32, i32, i32, i32) -> i32;

fn call_operation(operation: Operation, input: &Value) -> Value {
    let Ok(input) = serde_json::to_vec(input) else {
        return json!({ "ok": false, "error": "storage_failure" });
    };
    let mut output = vec![0_u8; OPERATION_BUFFER];
    let length = unsafe {
        operation(
            input.as_ptr() as i32,
            input.len() as i32,
            output.as_mut_ptr() as i32,
            output.len() as i32,
        )
    };
    let Ok(length) = usize::try_from(length) else {
        return json!({ "ok": false, "error": "storage_failure" });
    };
    serde_json::from_slice(&output[..length])
        .unwrap_or_else(|_| json!({ "ok": false, "error": "storage_failure" }))
}

fn response(status: u16, body: Value) -> Value {
    json!({ "status": status, "body": body })
}

fn read_request(pointer: i32, length: i32) -> Option<Request> {
    let (Ok(pointer), Ok(length)) = (usize::try_from(pointer), usize::try_from(length)) else {
        return None;
    };
    let bytes = unsafe { slice::from_raw_parts(pointer as *const u8, length) };
    serde_json::from_slice(bytes).ok()
}

fn emit(value: &Value) -> i64 {
    let Ok(bytes) = serde_json::to_vec(value) else {
        return 0;
    };
    let pointer = alloc(i32::try_from(bytes.len()).unwrap_or(0));
    if pointer == 0 {
        return 0;
    }
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer as *mut u8, bytes.len());
    }
    ((pointer as u32 as u64) << 32 | bytes.len() as u64) as i64
}

fn allocate(length: usize) -> Option<*mut u8> {
    let layout = Layout::array::<u8>(length.max(1)).ok()?;
    let pointer = unsafe { allocate_bytes(layout) };
    (!pointer.is_null()).then_some(pointer)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn memcmp(left: *const u8, right: *const u8, length: usize) -> i32 {
    for index in 0..length {
        let left_byte = unsafe { *left.add(index) };
        let right_byte = unsafe { *right.add(index) };
        if left_byte != right_byte {
            return i32::from(left_byte) - i32::from(right_byte);
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::{is_deleted_record, is_suspended_user, public_user, valid_name, valid_status};
    use serde_json::json;

    #[test]
    fn accepts_one_through_one_hundred_unicode_scalars() {
        assert!(valid_name("a"));
        assert!(valid_name(&"🙂".repeat(100)));
    }

    #[test]
    fn rejects_empty_and_more_than_one_hundred_unicode_scalars() {
        assert!(!valid_name(""));
        assert!(!valid_name(&"🙂".repeat(101)));
    }

    #[test]
    fn accepts_only_public_user_status_values() {
        assert!(valid_status("active"));
        assert!(valid_status("suspended"));
        assert!(!valid_status("deleted"));
        assert!(!valid_status("Active"));
    }

    #[test]
    fn counts_unicode_scalars_instead_of_utf8_bytes() {
        assert!(valid_name(&"é".repeat(100)));
        assert!(!valid_name(&"é".repeat(101)));
    }

    #[test]
    fn public_user_filters_internal_metadata() {
        let stored = json!({
            "id": 7,
            "name": "Ada",
            "email": "ada@example.com",
            "verified": false,
            "status": "active",
            "suspension_reason": "internal-only",
            "deleted": false,
            "created_at": "2026-08-29T00:00:00Z",
            "audit": { "updated_by": "system" },
            "audit_record": { "action": "email_changed" },
            "audit_metadata": { "request_id": "secret" }
        });

        let public = public_user(stored.as_object().expect("object"));

        assert_eq!(
            public,
            json!({
                "id": 7,
                "name": "Ada",
                "email": "ada@example.com",
                "verified": false,
                "status": "active"
            })
        );
    }

    #[test]
    fn recognizes_soft_deleted_users() {
        let deleted = json!({ "deleted": true });
        let status_deleted = json!({ "status": "deleted" });
        let active = json!({ "deleted": false, "status": "active" });

        assert!(is_deleted_record(deleted.as_object().expect("object")));
        assert!(is_deleted_record(
            status_deleted.as_object().expect("object")
        ));
        assert!(!is_deleted_record(active.as_object().expect("object")));
    }

    #[test]
    fn recognizes_suspended_users_from_stored_user() {
        let suspended = json!({ "ok": true, "user": { "status": "suspended" } });
        let active = json!({ "ok": true, "user": { "status": "active" } });

        assert!(is_suspended_user(&suspended));
        assert!(!is_suspended_user(&active));
    }
}
