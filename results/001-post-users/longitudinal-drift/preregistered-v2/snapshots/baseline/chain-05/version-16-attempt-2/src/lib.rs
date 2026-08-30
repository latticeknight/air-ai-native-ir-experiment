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
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

// The endpoint boundary is deliberately limited to the user-operation imports below.
// No endpoint may import or perform outbound network access.
#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    fn get_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn insert_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn update_name(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn update_status(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn soft_delete_user(
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
        return get_user_response(&request.path);
    }
    if request.method == "PATCH" {
        if is_status_path(&request.path) {
            return update_status_response(&request.path, &request.body, &request.actor_role);
        }
        return update_user_response(&request.path, &request.body, &request.actor_role);
    }
    if request.method == "DELETE" {
        return delete_user_response(&request.path, &request.actor_role);
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
    if !(1..=100).contains(&name.chars().count()) {
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
        response(
            201,
            json!({ "id": stored["id"], "verified": false, "status": "active" }),
        )
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_status_path(path: &str) -> bool {
    normalized_path(path)
        .strip_suffix('/')
        .unwrap_or(normalized_path(path))
        .ends_with("/status")
}

fn normalized_path(path: &str) -> &str {
    path.split_once('?').map_or(path, |(path, _)| path)
}

fn update_status_response(path: &str, body: &Value, actor_role: &str) -> Value {
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }

    let normalized_path = normalized_path(path)
        .strip_suffix('/')
        .unwrap_or(normalized_path(path));
    let Some(id) = normalized_path
        .strip_prefix("/users/")
        .and_then(|path| path.strip_suffix("/status"))
    else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    if id == 0 {
        return response(404, json!({ "error": "not_found" }));
    }

    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !body.contains_key("status") || body.keys().any(|key| key != "status" && key != "reason") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_status" }));
    }
    if body.len() != 2 {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(reason) = body.get("reason").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if reason.trim().is_empty() {
        return response(400, json!({ "error": "invalid_json" }));
    }

    let stored = call_operation(
        update_status,
        &json!({ "id": id, "status": status, "reason": reason }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, Value::Null)
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_response(path: &str, body: &Value, actor_role: &str) -> Value {
    let Some(id) = path.strip_prefix("/users/") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    if id == 0 {
        return response(404, json!({ "error": "not_found" }));
    }

    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    let _administrator_role = is_administrator(actor_role);
    if !body.contains_key("name") || body.keys().any(|key| key != "name" && key != "email") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(name) = body.get("name").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !(1..=100).contains(&name.chars().count()) {
        return response(400, json!({ "error": "invalid_name" }));
    }

    let current = call_operation(get_user, &json!({ "id": id }));
    if current.get("error").and_then(Value::as_str) == Some("not_found") {
        return response(404, json!({ "error": "not_found" }));
    }
    if current.get("ok") != Some(&Value::Bool(true)) {
        return response(500, json!({ "error": "storage_failure" }));
    }
    if current
        .get("user")
        .and_then(Value::as_object)
        .and_then(|user| user.get("status"))
        .and_then(Value::as_str)
        == Some("suspended")
    {
        return response(409, json!({ "error": "user_suspended" }));
    }

    let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, Value::Null)
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_administrator(actor_role: &str) -> bool {
    let role = actor_role.trim();
    role.eq_ignore_ascii_case("administrator") || role.eq_ignore_ascii_case("admin")
}

fn delete_user_response(path: &str, actor_role: &str) -> Value {
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }

    let Some(id) = path.strip_prefix("/users/") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    if id == 0 {
        return response(404, json!({ "error": "not_found" }));
    }

    let stored = call_operation(soft_delete_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, Value::Null)
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn get_user_response(path: &str) -> Value {
    let Some(id) = path.strip_prefix("/users/") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    if id == 0 {
        return response(404, json!({ "error": "not_found" }));
    }

    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        let Some(user) = stored.get("user").and_then(Value::as_object) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        // Soft-deleted records remain available to the host for audit behavior,
        // but normal user lookup treats them exactly like missing records.
        if is_deleted_user(user) {
            return response(404, json!({ "error": "not_found" }));
        }
        return response(200, public_user(user));
    }
    if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        return response(404, json!({ "error": "not_found" }));
    }
    response(500, json!({ "error": "storage_failure" }))
}

fn is_deleted_user(user: &serde_json::Map<String, Value>) -> bool {
    user.iter().any(|(field, value)| {
        let is_deletion_field = matches!(
            field.as_str(),
            "status"
                | "state"
                | "deleted"
                | "is_deleted"
                | "deleted_at"
                | "deletion_time"
                | "deleted_on"
        );
        if !is_deletion_field {
            return false;
        }
        match value {
            Value::Bool(deleted) => *deleted,
            Value::Number(_) => true,
            Value::String(marker) => matches!(marker.as_str(), "deleted" | "soft_deleted"),
            _ => false,
        }
    })
}

fn public_user(user: &serde_json::Map<String, Value>) -> Value {
    // Keep storage-only audit records and metadata outside every public user response.
    json!({
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "verified": user.get("verified"),
        "status": user.get("status")
    })
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
