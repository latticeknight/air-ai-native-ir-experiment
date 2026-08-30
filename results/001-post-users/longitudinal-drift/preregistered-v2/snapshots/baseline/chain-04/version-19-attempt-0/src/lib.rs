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
const PUBLIC_USER_FIELDS: [&str; 5] = ["id", "name", "email", "verified", "status"];

#[global_allocator]
static ALLOCATOR: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    // Endpoints are limited to these storage imports and never access outbound network capabilities.
    fn get_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn insert_user(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn soft_delete_user(
        input_ptr: i32,
        input_len: i32,
        output_ptr: i32,
        output_capacity: i32,
    ) -> i32;
    fn update_name(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
    fn update_status(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32) -> i32;
}

#[link(wasm_import_module = "air_profiles_v1")]
unsafe extern "C" {
    fn upsert_profile(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32)
    -> i32;
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
        if let Some(id_text) = status_route_id(&request.path) {
            return update_user_status(id_text, &request.body, &request.actor_role);
        }
        return update_user(&request.path, &request.body);
    }
    if request.method == "DELETE" {
        return delete_user(&request.path, &request.actor_role);
    }
    if request.method == "PUT" {
        return update_user_profile(&request.path, &request.body);
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
    if !validation::valid_name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }
    if !validation::valid_email(email) {
        return response(400, json!({ "error": "invalid_email" }));
    }
    let stored = call_operation(
        insert_user,
        &json!({ "name": name, "email": email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(201, created_user_response(&stored))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_profile(path: &str, body: &Value) -> Value {
    let normalized_path = path.strip_suffix('/').unwrap_or(path);

    let Some(user_id) = normalized_path
        .strip_prefix("/users/")
        .and_then(|value| value.strip_suffix("/profile"))
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
    else {
        return response(404, json!({ "error": "not_found" }));
    };

    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(timezone) = body.get("timezone").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if timezone.is_empty() {
        return response(400, json!({ "error": "invalid_json" }));
    }

    let stored = call_operation(
        upsert_profile,
        &json!({ "user_id": user_id, "timezone": timezone }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "timezone": stored["timezone"] }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user(path: &str, body: &Value) -> Value {
    let normalized_path = path.strip_suffix('/').unwrap_or(path);

    let Some(id) = normalized_path
        .strip_prefix("/users/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
    else {
        return response(404, json!({ "error": "not_found" }));
    };

    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 {
        return response(400, json!({ "error": "invalid_json" }));
    }

    if let Some(name) = body.get("name").and_then(Value::as_str) {
        if !validation::valid_name(name) {
            return response(400, json!({ "error": "invalid_name" }));
        }
        let current = call_operation(get_user, &json!({ "id": id }));
        if current.get("ok") != Some(&Value::Bool(true)) {
            if current.get("error").and_then(Value::as_str) == Some("not_found") {
                return response(404, json!({ "error": "not_found" }));
            }
            return response(500, json!({ "error": "storage_failure" }));
        }
        let Some(user) = current.get("user").and_then(Value::as_object) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        if user.get("status").and_then(Value::as_str) == Some("suspended") {
            return response(409, json!({ "error": "user_suspended" }));
        }
        let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
        return update_result(stored);
    }

    response(400, json!({ "error": "invalid_json" }))
}

fn status_route_id(path: &str) -> Option<&str> {
    let path = path.strip_suffix('/').unwrap_or(path);
    let id = path.strip_prefix("/users/")?.strip_suffix("/status")?;
    (!id.is_empty() && !id.contains('/')).then_some(id)
}

fn update_user_status(id_text: &str, body: &Value, actor_role: &str) -> Value {
    let Some(id) = id_text.parse::<u64>().ok().filter(|id| *id > 0) else {
        return response(404, json!({ "error": "not_found" }));
    };

    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }

    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.get("status").and_then(Value::as_str) == Some("active") {
        return response(400, json!({ "error": "invalid_status" }));
    }
    if body.len() != 2 {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_status" }));
    }
    let Some(reason) = body.get("reason").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if reason.is_empty() {
        return response(400, json!({ "error": "invalid_json" }));
    }

    let stored = call_operation(
        update_status,
        &json!({ "id": id, "status": status, "reason": reason }),
    );
    update_result(stored)
}

fn update_result(stored: Value) -> Value {
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, updated_user_response())
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_administrator(actor_role: &str) -> bool {
    actor_role.eq_ignore_ascii_case("administrator") || actor_role.eq_ignore_ascii_case("admin")
}

fn delete_user(path: &str, actor_role: &str) -> Value {
    let Some(id) = path
        .strip_prefix("/users/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
    else {
        return response(404, json!({ "error": "not_found" }));
    };

    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }

    let stored = call_operation(soft_delete_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, json!({}))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn created_user_response(stored: &Value) -> Value {
    // The insert operation may return storage metadata, but the create endpoint
    // exposes only the public identifier and verification default.
    json!({ "id": stored["id"], "verified": false })
}

fn updated_user_response() -> Value {
    // The update operation result is internal implementation data.
    json!({ "ok": true })
}

fn lookup_user(path: &str) -> Value {
    let Some(id) = path
        .strip_prefix("/users/")
        .filter(|value| !value.is_empty() && !value.contains('/'))
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|id| *id > 0)
    else {
        return response(404, json!({ "error": "not_found" }));
    };

    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        if stored.as_object().is_some_and(is_deleted_record) {
            return response(404, json!({ "error": "not_found" }));
        }
        let Some(user) = stored.get("user").and_then(Value::as_object) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        if is_deleted_record(user) {
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

fn is_deleted_record(record: &serde_json::Map<String, Value>) -> bool {
    record.get("status").and_then(Value::as_str) == Some("deleted")
        || record.get("deleted") == Some(&Value::Bool(true))
        || record.get("is_deleted") == Some(&Value::Bool(true))
        || record
            .get("deleted_at")
            .is_some_and(|value| !value.is_null())
}

fn public_user(user: &serde_json::Map<String, Value>) -> Value {
    let mut filtered = serde_json::Map::new();
    for field in PUBLIC_USER_FIELDS {
        let value = user.get(field).cloned().unwrap_or(Value::Null);
        filtered.insert(field.into(), value);
    }
    Value::Object(filtered)
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
