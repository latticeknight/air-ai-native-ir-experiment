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
    #[serde(rename = "actor_role")]
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
        if request.path.ends_with("/status") {
            return update_user_status_response(&request.path, &request.actor_role, &request.body);
        }
        return update_user_response(&request.path, &request.body);
    }
    if request.method == "DELETE" {
        return delete_user_response(&request.path, &request.actor_role);
    }
    if request.method != "POST" || request.path != "/users" {
        return response(404, json!({ "error": "not_found" }));
    }
    create_user_response(&request.body)
}

fn create_user_response(body: &Value) -> Value {
    let (name, email) = match validate_create_body(body) {
        Ok(fields) => fields,
        Err(error) => return response(400, json!({ "error": error })),
    };
    let stored = call_operation(
        insert_user,
        &json!({ "name": name, "email": email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        // Return only the create route's public fields, never the host result.
        response(201, json!({ "id": stored["id"], "verified": false }))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn validate_create_body(body: &Value) -> Result<(&str, &str), &'static str> {
    let Some(body) = body.as_object() else {
        return Err("invalid_json");
    };
    if body.len() != 2 || !body.contains_key("name") || !body.contains_key("email") {
        return Err("invalid_json");
    }
    let Some(name) = body.get("name").and_then(Value::as_str) else {
        return Err("invalid_json");
    };
    let Some(email) = body.get("email").and_then(Value::as_str) else {
        return Err("invalid_json");
    };
    if !valid_name(name) {
        return Err("invalid_name");
    }
    if !valid_email(email) {
        return Err("invalid_email");
    }
    Ok((name, email))
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
    let deleted = call_operation(soft_delete_user, &json!({ "id": id }));
    if deleted.get("ok") == Some(&Value::Bool(true)) {
        response(204, json!({}))
    } else if deleted.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_response(path: &str, body: &Value) -> Value {
    let Some(id) = path.strip_prefix("/users/") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 || !body.contains_key("name") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(name) = body.get("name").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !valid_name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }
    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        if stored["user"].get("status").and_then(Value::as_str) == Some("suspended") {
            return response(409, json!({ "error": "user_suspended" }));
        }
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        return response(404, json!({ "error": "not_found" }));
    } else {
        return response(500, json!({ "error": "storage_failure" }));
    }
    let updated = call_operation(update_name, &json!({ "id": id, "name": name }));
    if updated.get("ok") == Some(&Value::Bool(true)) {
        // Return only the update route's public fields, never the host result.
        response(200, json!({ "id": id, "name": name }))
    } else if updated.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user_status_response(path: &str, actor_role: &str, body: &Value) -> Value {
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(id) = path
        .strip_prefix("/users/")
        .and_then(|path| path.strip_suffix("/status"))
    else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !body.contains_key("status") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if status != "suspended" {
        return response(400, json!({ "error": "invalid_status" }));
    }
    if body.len() > 2 {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let reason = match body.get("reason") {
        None => None,
        Some(reason) => {
            let Some(reason) = reason.as_str() else {
                return response(400, json!({ "error": "invalid_json" }));
            };
            if reason.is_empty() {
                return response(400, json!({ "error": "invalid_json" }));
            }
            Some(reason)
        }
    };
    let update = match reason {
        Some(reason) => json!({ "id": id, "status": status, "reason": reason }),
        None => json!({ "id": id, "status": status }),
    };
    let updated = call_operation(update_status, &update);
    if updated.get("ok") == Some(&Value::Bool(true)) {
        response(200, json!({ "id": id, "status": status }))
    } else if updated.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_administrator(actor_role: &str) -> bool {
    actor_role.eq_ignore_ascii_case("admin") || actor_role.eq_ignore_ascii_case("administrator")
}

fn get_user_response(path: &str) -> Value {
    let Some(id) = path.strip_prefix("/users/") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(id) = id.parse::<u64>() else {
        return response(404, json!({ "error": "not_found" }));
    };
    let stored = call_operation(get_user, &json!({ "id": id }));
    if stored.get("ok") == Some(&Value::Bool(true)) {
        if is_deleted(&stored["user"]) {
            return response(404, json!({ "error": "not_found" }));
        }
        response(200, public_user(&stored["user"]))
    } else if stored.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_deleted(user: &Value) -> bool {
    user.get("deleted") == Some(&Value::Bool(true))
        || user.get("status").and_then(Value::as_str) == Some("deleted")
        || !user.get("deleted_at").is_none_or(Value::is_null)
}

fn public_user(user: &Value) -> Value {
    // Project only the contract's public fields. The host may include storage,
    // deletion, or audit metadata in the user object, but none of it is public.
    json!({
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "verified": user["verified"],
        "status": user["status"]
    })
}

fn valid_name(value: &str) -> bool {
    (2..=80).contains(&value.chars().count())
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
