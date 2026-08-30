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

#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    // These are the only host imports available to every endpoint. In particular,
    // endpoints cannot import or perform outbound network access.
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

#[derive(Deserialize)]
struct Request {
    method: String,
    path: String,
    actor_role: String,
    #[serde(default)]
    body: Option<Value>,
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
    if request.method == "DELETE" {
        return delete_user_response(&request.path, &request.actor_role);
    }
    if request.method == "PATCH" && request.path.ends_with("/status") {
        return update_status_response(&request.path, &request.actor_role, request.body.as_ref());
    }
    if request.body.is_none() {
        return response(400, json!({ "error": "invalid_json" }));
    }
    if request.method == "PATCH" {
        return update_user_response(&request.path, request.body.as_ref());
    }
    if request.method != "POST" || request.path != "/users" {
        return response(404, json!({ "error": "not_found" }));
    }
    let Some(body) = request.body.as_ref().and_then(Value::as_object) else {
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
        response(201, json!({ "id": stored["id"], "verified": false }))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_status_response(path: &str, actor_role: &str, body: Option<&Value>) -> Value {
    if actor_role != "administrator" {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(id_path) = path.strip_suffix("/status") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(id) = user_id(id_path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.and_then(Value::as_object) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !body.contains_key("status") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_status" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_status" }));
    }
    let reason = match body.get("reason") {
        None => None,
        Some(value) => {
            let Some(reason) = value.as_str() else {
                return response(400, json!({ "error": "invalid_reason" }));
            };
            if reason.is_empty() {
                return response(400, json!({ "error": "invalid_reason" }));
            }
            Some(reason)
        }
    };

    let input = match reason {
        Some(reason) => json!({ "id": id, "status": status, "reason": reason }),
        None => json!({ "id": id, "status": status }),
    };
    let stored = call_operation(update_status, &input);
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "id": id, "status": status }))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_response(path: &str, body: Option<&Value>) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.and_then(Value::as_object) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 || !body.contains_key("name") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(name) = body.get("name").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !(1..=100).contains(&name.chars().count()) {
        return response(400, json!({ "error": "invalid_name" }));
    }

    let current = call_operation(get_user, &json!({ "id": id }));
    if current.get("ok") != Some(&Value::Bool(true)) {
        if current.get("error").and_then(Value::as_str) != Some("not_found") {
            return response(500, json!({ "error": "storage_failure" }));
        }
        return response(404, json!({ "error": "not_found" }));
    }
    let Some(user) = current.get("user").and_then(Value::as_object) else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    if user.get("status").and_then(Value::as_str) == Some("suspended") {
        return response(409, json!({ "error": "user_suspended" }));
    }

    let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "id": id, "name": name }))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn user_id(path: &str) -> Option<u64> {
    let id = path.strip_prefix("/users/")?.parse::<u64>().ok()?;
    (id != 0).then_some(id)
}

fn get_user_response(path: &str) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };

    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") != Some(&Value::Bool(true)) {
        if stored.get("error").and_then(Value::as_str) != Some("not_found") {
            return response(500, json!({ "error": "storage_failure" }));
        }
        return response(404, json!({ "error": "not_found" }));
    }
    let Some(user) = stored.get("user").and_then(Value::as_object) else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    if is_deleted_user(user) {
        return response(404, json!({ "error": "not_found" }));
    }
    let Some(id) = user.get("id") else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    let Some(name) = user.get("name") else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    let Some(email) = user.get("email") else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    let Some(verified) = user.get("verified") else {
        return response(500, json!({ "error": "storage_failure" }));
    };
    let default_status = Value::String(String::from("active"));
    let status = user.get("status").unwrap_or(&default_status);
    response(200, public_user(id, name, email, verified, status))
}

fn is_deleted_user(user: &serde_json::Map<String, Value>) -> bool {
    let deleted_flag = ["deleted", "is_deleted"]
        .iter()
        .any(|field| user.get(*field).and_then(Value::as_bool) == Some(true));
    let deleted_timestamp = user.get("deleted_at").is_some_and(|value| !value.is_null());
    let non_visible_status = match user.get("status") {
        None => false,
        Some(Value::String(status)) => status != "active" && status != "suspended",
        Some(_) => true,
    };

    deleted_flag || deleted_timestamp || non_visible_status
}

fn delete_user_response(path: &str, actor_role: &str) -> Value {
    if actor_role != "administrator" {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };

    let stored = call_operation(soft_delete_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(204, json!({}))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

// Keep the public response shape separate from the storage result so internal
// metadata returned by the host operation can never cross the API boundary.
fn public_user(id: &Value, name: &Value, email: &Value, verified: &Value, status: &Value) -> Value {
    json!({
        "id": id,
        "name": name,
        "email": email,
        "verified": verified,
        "status": status,
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
