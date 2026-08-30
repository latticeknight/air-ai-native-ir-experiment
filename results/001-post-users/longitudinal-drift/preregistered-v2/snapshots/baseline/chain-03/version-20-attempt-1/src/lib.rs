#![no_std]

extern crate alloc;

use alloc::alloc::{Layout, alloc as allocate_bytes, dealloc as deallocate_bytes};
use alloc::string::String;
use alloc::vec;
use core::slice;

use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};

mod validation;

// Endpoints are limited to the declared table-scoped storage imports and never
// import or perform outbound network access.
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

#[link(wasm_import_module = "air_profiles_v1")]
unsafe extern "C" {
    fn upsert_profile(input_ptr: i32, input_len: i32, output_ptr: i32, output_capacity: i32)
    -> i32;
}

#[derive(Deserialize)]
struct Request {
    method: String,
    path: String,
    #[serde(
        deserialize_with = "deserialize_actor_role",
        alias = "role",
        alias = "actorRole",
        alias = "actor",
        alias = "user_role",
        alias = "userRole"
    )]
    actor_role: String,
    body: Value,
}

fn deserialize_actor_role<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(role) => Ok(role),
        Value::Object(actor) => actor
            .get("role")
            .or_else(|| actor.get("actor_role"))
            .or_else(|| actor.get("actorRole"))
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| serde::de::Error::custom("actor role must be a string")),
        _ => Err(serde::de::Error::custom("actor role must be a string")),
    }
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
    if request.method == "GET" && request.path == "/health" {
        return response(200, json!({ "status": "ok" }));
    }
    if request.method == "GET" {
        return lookup_user(&request.path);
    }
    if request.method == "PATCH" && request.path.ends_with("/status") {
        return update_user_status(&request.path, &request.body, &request.actor_role);
    }
    if request.method == "PATCH" {
        return update_user(&request.path, &request.body, &request.actor_role);
    }
    if request.method == "PUT" && request.path.ends_with("/profile") {
        return update_profile(&request.path, &request.body);
    }
    if request.method == "DELETE" {
        return delete_user(&request.path, &request.actor_role);
    }
    if request.method != "POST" || request.path != "/users" {
        return response(404, json!({ "error": "not_found" }));
    }
    let user = match validation::new_user(&request.body) {
        Ok(user) => user,
        Err(validation::Error::InvalidJson) => {
            return response(400, json!({ "error": "invalid_json" }));
        }
        Err(validation::Error::InvalidName) => {
            return response(400, json!({ "error": "invalid_name" }));
        }
        Err(validation::Error::InvalidEmail) => {
            return response(400, json!({ "error": "invalid_email" }));
        }
    };
    let stored = call_operation(
        insert_user,
        &json!({ "name": user.name, "email": user.email, "verified": false, "status": "active" }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        response(201, json!({ "id": stored["id"], "verified": false }))
    } else if stored.get("error").and_then(Value::as_str) == Some("duplicate_email") {
        response(409, json!({ "error": "duplicate_email" }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_profile(path: &str, body: &Value) -> Value {
    let Some(profile_path) = path.strip_suffix("/profile") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(id) = user_id(profile_path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Ok(timezone) = validation::profile_timezone(body) else {
        return response(400, json!({ "error": "invalid_json" }));
    };

    let stored = call_operation(
        upsert_profile,
        &json!({ "user_id": id, "timezone": timezone }),
    );
    if stored.get("ok") == Some(&Value::Bool(true)) {
        let Some(timezone) = stored.get("timezone") else {
            return response(500, json!({ "error": "storage_failure" }));
        };
        response(200, json!({ "timezone": timezone }))
    } else {
        response(500, json!({ "error": "storage_failure" }))
    }
}

fn update_user(path: &str, body: &Value, _actor_role: &str) -> Value {
    let Some(id) = user_id(path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    match validation::updated_name(body) {
        Ok(name) => {
            let current = call_operation(get_user, &json!({ "id": id }));
            if is_suspended_user(&current) {
                return response(409, json!({ "error": "user_suspended" }));
            }

            let stored = call_operation(update_name, &json!({ "id": id, "name": name }));
            update_result(&stored)
        }
        Err(validation::Error::InvalidName) => response(400, json!({ "error": "invalid_name" })),
        Err(validation::Error::InvalidJson | validation::Error::InvalidEmail) => {
            response(400, json!({ "error": "invalid_json" }))
        }
    }
}

fn update_user_status(path: &str, body: &Value, actor_role: &str) -> Value {
    let Some(user_path) = path.strip_suffix("/status") else {
        return response(404, json!({ "error": "not_found" }));
    };
    let Some(id) = user_id(user_path) else {
        return response(404, json!({ "error": "not_found" }));
    };
    if !is_administrator(actor_role) {
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
    if !valid_status(status) || status == "active" {
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
    if !is_administrator(actor_role) {
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

fn valid_status(value: &str) -> bool {
    matches!(value, "active" | "suspended")
}

fn is_administrator(actor_role: &str) -> bool {
    let role = actor_role.trim();
    role.eq_ignore_ascii_case("administrator") || role.eq_ignore_ascii_case("admin")
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
    use super::{
        Request, dispatch, is_administrator, is_deleted_record, is_suspended_user, public_user,
        valid_status, validation,
    };
    use serde_json::json;

    #[test]
    fn accepts_role_alias_in_request_envelope() {
        let request: Request = serde_json::from_value(json!({
            "method": "PATCH",
            "path": "/users/1/status",
            "role": "administrator",
            "body": { "status": "suspended", "reason": "policy violation" }
        }))
        .expect("request should deserialize");

        assert_eq!(request.actor_role, "administrator");
    }

    #[test]
    fn accepts_camel_case_role_alias_in_request_envelope() {
        let request: Request = serde_json::from_value(json!({
            "method": "PATCH",
            "path": "/users/1/status",
            "actorRole": "administrator",
            "body": { "status": "suspended", "reason": "policy violation" }
        }))
        .expect("request should deserialize");

        assert!(is_administrator(&request.actor_role));
    }

    #[test]
    fn accepts_role_from_structured_actor_in_request_envelope() {
        let request: Request = serde_json::from_value(json!({
            "method": "PATCH",
            "path": "/users/1/status",
            "actor": { "role": "administrator" },
            "body": { "status": "suspended", "reason": "policy violation" }
        }))
        .expect("request should deserialize");

        assert!(is_administrator(&request.actor_role));
    }

    #[test]
    fn health_endpoint_returns_ok_without_storage() {
        let response = dispatch(
            serde_json::from_value(json!({
                "method": "GET",
                "path": "/health",
                "actor_role": "",
                "body": null
            }))
            .expect("request should deserialize"),
        );

        assert_eq!(
            response,
            json!({ "status": 200, "body": { "status": "ok" } })
        );
    }

    #[test]
    fn accepts_two_through_eighty_unicode_scalars() {
        assert!(validation::name("ab"));
        assert!(validation::name(&"🙂".repeat(80)));
    }

    #[test]
    fn rejects_fewer_than_two_and_more_than_eighty_unicode_scalars() {
        assert!(!validation::name(""));
        assert!(!validation::name("a"));
        assert!(!validation::name(&"🙂".repeat(81)));
    }

    #[test]
    fn accepts_only_public_user_status_values() {
        assert!(valid_status("active"));
        assert!(valid_status("suspended"));
        assert!(!valid_status("deleted"));
        assert!(!valid_status("Active"));
    }

    #[test]
    fn recognizes_administrator_roles_for_protected_operations() {
        assert!(is_administrator("administrator"));
        assert!(is_administrator("admin"));
        assert!(is_administrator(" Administrator "));
        assert!(!is_administrator("user"));
    }

    #[test]
    fn counts_unicode_scalars_instead_of_utf8_bytes() {
        assert!(validation::name(&"é".repeat(80)));
        assert!(!validation::name(&"é".repeat(81)));
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
