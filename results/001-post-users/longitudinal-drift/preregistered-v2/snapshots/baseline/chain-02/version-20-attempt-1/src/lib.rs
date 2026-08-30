#![no_std]

extern crate alloc;

use alloc::alloc::{Layout, alloc as allocate_bytes, dealloc as deallocate_bytes};
use alloc::string::String;
use alloc::vec;
use core::slice;

use serde::Deserialize;
use serde_json::{Value, json};

const OPERATION_BUFFER: usize = 65_536;

mod validation {
    pub(super) fn name(value: &str) -> bool {
        (2..=80).contains(&value.chars().count())
    }

    pub(super) fn email(value: &str) -> bool {
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
}

#[global_allocator]
static ALLOCATOR: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[link(wasm_import_module = "air_users_v1")]
unsafe extern "C" {
    // These are the complete host imports. No endpoint imports or performs outbound network access.
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

#[link(wasm_import_module = "air_profiles_v1")]
unsafe extern "C" {
    fn upsert_profile(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32)
    -> i32;
}

#[derive(Deserialize)]
struct Request {
    method: String,
    path: String,
    #[serde(alias = "role", alias = "actor", alias = "actorRole")]
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
        if request.path == "/health" {
            return response(200, json!({ "status": "ok" }));
        }
        return lookup_user(&request.path);
    }
    if request.method == "PATCH" {
        if status_user_id(&request.path).is_some() {
            return update_status_user(&request.path, &request.actor_role, &request.body);
        }
        return update_user(&request.path, &request.body);
    }
    if request.method == "DELETE" {
        return delete_user(&request.path, &request.actor_role);
    }
    if request.method == "PUT" {
        return update_profile(&request.path, &request.body);
    }
    if request.method != "POST" || request.path != "/users" {
        return response(404, json!({ "error": "not_found" }));
    }
    create_user(&request.body)
}

fn create_user(body: &Value) -> Value {
    let Some(body) = body.as_object() else {
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
    if !validation::name(name) {
        return response(400, json!({ "error": "invalid_name" }));
    }
    if !validation::email(email) {
        return response(400, json!({ "error": "invalid_email" }));
    }
    let stored = call_operation(
        insert_user,
        &json!({ "name": name, "email": email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(
            201,
            created_user(stored.get("id").cloned().unwrap_or(Value::Null)),
        )
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn delete_user(path: &str, actor_role: &str) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }

    let deleted = call_operation(soft_delete_user, &json!({ "id": id }));
    if deleted.get("ok") == Some(&Value::Bool(true)) {
        response(204, Value::Null)
    } else if deleted.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user(path: &str, body: &Value) -> Value {
    let Some(id) = user_id(path) else {
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
    if !validation::name(name) {
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
    } else if current.get("error").and_then(Value::as_str) != Some("not_found") {
        return response(500, json!({ "error": "storage_failure" }));
    }

    let updated = call_operation(update_name, &json!({ "id": id, "name": name }));
    if updated.get("ok") == Some(&Value::Bool(true)) {
        response(200, Value::Null)
    } else if updated.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_status_user(path: &str, actor_role: &str, body: &Value) -> Value {
    let Some(id) = status_user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    if !is_administrator(actor_role) {
        return response(403, json!({ "error": "forbidden" }));
    }
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 2 || !body.contains_key("status") || !body.contains_key("reason") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(status) = body.get("status").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if !valid_status(status) {
        return response(400, json!({ "error": "invalid_status" }));
    }
    let mut input = json!({ "id": id, "status": status });
    let Some(reason) = body.get("reason").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if reason.is_empty() {
        return response(400, json!({ "error": "invalid_reason" }));
    }
    input
        .as_object_mut()
        .expect("status input is an object")
        .insert("reason".into(), Value::String(reason.into()));

    let updated = call_operation(update_status, &input);
    if updated.get("ok") == Some(&Value::Bool(true)) {
        response(200, Value::Null)
    } else if updated.get("error").and_then(Value::as_str) == Some("not_found") {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_profile(path: &str, body: &Value) -> Value {
    let Some(id) = profile_user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(body) = body.as_object() else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if body.len() != 1 || !body.contains_key("timezone") {
        return response(400, json!({ "error": "invalid_json" }));
    }
    let Some(timezone) = body.get("timezone").and_then(Value::as_str) else {
        return response(400, json!({ "error": "invalid_json" }));
    };
    if timezone.is_empty() {
        return response(400, json!({ "error": "invalid_timezone" }));
    }

    let stored = call_operation(
        upsert_profile,
        &json!({ "user_id": id, "timezone": timezone }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        let Some(timezone) = stored.get("timezone").and_then(Value::as_str) else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        response(200, json!({ "timezone": timezone }))
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
        if is_deleted_user(user) || is_deleted_result(&stored) {
            return response(404, json!({ "error": "not_found" }));
        }
        return response(200, public_user(user));
    }
    if stored.get("error").and_then(Value::as_str) == Some("not_found")
        || stored.get("error").and_then(Value::as_str) == Some("deleted")
    {
        response(404, json!({ "error": "not_found" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn is_deleted_user(user: &serde_json::Map<String, Value>) -> bool {
    user.iter().any(|(key, value)| {
        let key = key.to_ascii_lowercase();
        if key == "status" || key == "state" || key == "lifecycle" {
            return value.as_str() == Some("deleted")
                || value.get("deleted").and_then(Value::as_bool) == Some(true);
        }
        if key == "deleted" || key == "is_deleted" {
            return value.as_bool() == Some(true) || value.as_str() == Some("true");
        }
        key == "deleted_at" && !value.is_null()
    })
}

fn is_deleted_result(stored: &Value) -> bool {
    stored.get("deleted").and_then(Value::as_bool) == Some(true)
        || stored.get("is_deleted").and_then(Value::as_bool) == Some(true)
}

fn user_id(path: &str) -> Option<u64> {
    let id = path.strip_prefix("/users/")?.parse::<u64>().ok()?;
    (id != 0).then_some(id)
}

fn status_user_id(path: &str) -> Option<u64> {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    let path = path.strip_suffix('/').unwrap_or(path);
    let id = path
        .strip_prefix("/users/")?
        .strip_suffix("/status")?
        .parse::<u64>()
        .ok()?;
    (id != 0).then_some(id)
}

fn profile_user_id(path: &str) -> Option<u64> {
    let id = path
        .strip_prefix("/users/")?
        .strip_suffix("/profile")?
        .parse::<u64>()
        .ok()?;
    (id != 0).then_some(id)
}

fn valid_status(value: &str) -> bool {
    value == "suspended"
}

fn is_administrator(actor_role: &str) -> bool {
    actor_role == "administrator" || actor_role == "admin"
}

fn public_user(user: &serde_json::Map<String, Value>) -> Value {
    // Construct the response from the public contract instead of serializing
    // the storage record, which may contain internal metadata.
    json!({
        "id": user.get("id").cloned().unwrap_or(Value::Null),
        "name": user.get("name").cloned().unwrap_or(Value::Null),
        "email": user.get("email").cloned().unwrap_or(Value::Null),
        "verified": user.get("verified").cloned().unwrap_or(Value::Null),
        "status": user.get("status").cloned().unwrap_or_else(|| json!("active"))
    })
}

fn created_user(id: Value) -> Value {
    // The create operation may return storage metadata, so construct the
    // response from the public contract rather than returning that record.
    json!({ "id": id, "verified": false })
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
