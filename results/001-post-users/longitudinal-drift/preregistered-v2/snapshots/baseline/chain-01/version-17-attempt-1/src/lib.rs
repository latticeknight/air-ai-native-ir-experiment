#![no_std]

extern crate alloc;

use alloc::alloc::{Layout, alloc as allocate_bytes, dealloc as deallocate_bytes};
use alloc::string::String;
use alloc::vec;
use core::slice;

use serde::Deserialize;
use serde_json::{Value, json};

mod validation;

const OPERATION_BUFFER: usize = 65_536;

#[global_allocator]
static ALLOCATOR: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    fn insert_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn get_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn soft_delete_user(
        input_ptr: i32,
        input_len: i32,
        output_ptr: i32,
        output_capacity: i32,
    ) -> i32;
    fn update_name(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn update_status(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
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
        if request.path.ends_with("/status") {
            return update_user_status(&request.path, &request.actor_role, &request.body);
        }
        return update_user(&request.path, &request.body);
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
    if !validation::is_valid_name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }
    if !validation::is_valid_email(email) {
        return response(400, json!({ "error": "invalid_email" }));
    }
    let stored = call_operation(
        insert_user,
        &json!({ "name": name, "email": email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        let Some(id) = stored.get("id").and_then(Value::as_u64) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        // Rebuild the response from typed public fields only.
        response(201, json!({ "id": id, "verified": false }))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn delete_user(path: &str, actor_role: &str) -> Value {
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };

    let stored = call_operation(soft_delete_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, Value::Null)
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user(path: &str, body: &Value) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(fields) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if fields.len() != 1 || !fields.contains_key("name") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(name) = fields.get("name").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !validation::is_valid_name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }

    let current = call_operation(get_user, &json!({ "id": id }));
    if current.get("ok") == Some(&Value::Bool(true)) {
        let Some(user) = current.get("user").and_then(Value::as_object) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        if user.get("status").and_then(Value::as_str) == Some("suspended") {
            return response(409, json!({ "error": "user_suspended" }));
        }
    } else if current.get("error").and_then(Value::as_str) == Some("not_found") {
        return response(404, json!({ "error": "not_found" }));
    } else {
        return response(500, json!({ "error": "storage_failure" }));
    }

    let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "ok": true }))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_status(path: &str, actor_role: &str, body: &Value) -> Value {
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(id) = status_user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(fields) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !fields.contains_key("status") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = fields.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_status" }));
    }
    if fields.len() > 2 || (fields.len() == 2 && !fields.contains_key("reason")) {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let reason = fields.get("reason").and_then(Value::as_str);
    if fields.contains_key("reason") && reason.is_none_or(str::is_empty) {
        return response(400, json!({ "error": "invalid_json" }));
    }

    let mut operation = json!({ "id": id, "status": status });
    if let Some(reason) = reason {
        operation["reason"] = json!(reason);
    }
    let stored = call_operation(update_status, &operation);
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "ok": true }))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
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
        if is_deleted_user(user) || stored.as_object().is_some_and(is_deleted_user) {
            return response(404, json!({ "error": "not_found" }));
        }
        let (Some(id), Some(name), Some(email), Some(verified), Some(status)) = (
            user.get("id"),
            user.get("name").and_then(Value::as_str),
            user.get("email").and_then(Value::as_str),
            user.get("verified").and_then(Value::as_bool),
            user.get("status").and_then(Value::as_str),
        ) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        if !matches!(status, "active" | "suspended") {
            return response(500, json!({ "error": "storage_failure" }));
        }
        // public_user is an explicit allowlist, so audit records and metadata
        // returned by storage cannot cross the endpoint boundary.
        let Some(id) = id.as_u64() else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        return response(200, public_user(id, name, email, verified, status));
    }
    if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_deleted_user(user: &serde_json::Map<String, Value>) -> bool {
    user.get("status").and_then(Value::as_str) == Some("deleted")
        || user.get("deleted").and_then(Value::as_bool) == Some(true)
        || user.get("is_deleted").and_then(Value::as_bool) == Some(true)
        || user.get("deleted_at").is_some_and(|value| !value.is_null())
}

fn user_id(path: &str) -> Option<u64> {
    let id = path.strip_prefix("/users/")?;
    if id.is_empty() || id.contains('/') {
        return None;
    }
    id.parse::<u64>().ok()
}

fn status_user_id(path: &str) -> Option<u64> {
    let id = path.strip_prefix("/users/")?.strip_suffix("/status")?;
    if id.is_empty() || id.contains('/') {
        return None;
    }
    id.parse::<u64>().ok()
}

fn is_administrator(actor_role: &str) -> bool {
    matches!(actor_role, "administrator" | "admin")
}

fn public_user(id: u64, name: &str, email: &str, verified: bool, status: &str) -> Value {
    let mut fields = serde_json::Map::new();
    fields.insert(String::from("id"), json!(id));
    fields.insert(String::from("name"), json!(name));
    fields.insert(String::from("email"), json!(email));
    fields.insert(String::from("verified"), json!(verified));
    fields.insert(String::from("status"), json!(status));
    Value::Object(fields)
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
