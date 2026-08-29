use std::collections::HashSet;

use crate::ast::{Field, FieldValue, Function, Program, ProgramBody, Statement, UserService};

pub const STDOUT_ID: &str = "wasi:stdout@1";
pub const STDOUT_DIGEST: &str =
    "sha256:d09b856e2e70a9ad921ee7af4f22a274c3f2727c0f94193263eea4e3c3229782";
pub const HTTP_SERVER_ID: &str = "air:http/server@1";
pub const HTTP_SERVER_DIGEST: &str =
    "sha256:9d8f75ab79c9a2fc51c2cfa1aa42d946741b7fcac462b1767e607bf1018879b6";
pub const JSON_ID: &str = "air:json@1";
pub const JSON_DIGEST: &str =
    "sha256:f276fd0e2abf43cd700d17ac7d5255969821283e5f2f184dd59f1d1bb6685a14";
pub const SQLITE_USERS_INSERT_ID: &str = "air:sqlite/users.insert@1";
pub const SQLITE_USERS_INSERT_DIGEST: &str =
    "sha256:b5a70c72dc2df26dd59e7508fcd06e828b89dfb1f2c6b318d5eb713be826d131";
pub const FOUNDATION_SIGNER: &str = "air:foundation";

const MAX_STATIC_DATA_BYTES: usize = 65_536 - 64;

pub fn check(program: &Program) -> Result<(), String> {
    if program.version != "0.1" {
        return Err(format!(
            "unsupported AIR version `{}`; this compiler accepts 0.1",
            program.version
        ));
    }

    let mut declared = HashSet::new();
    for capability in &program.capabilities {
        if !declared.insert(capability.id.as_str()) {
            return Err(format!(
                "capability `{}` is declared more than once",
                capability.id
            ));
        }
        let Some(expected_digest) = trusted_digest(&capability.id) else {
            return Err(format!(
                "capability `{}` is not in the compiler's trusted capability set",
                capability.id
            ));
        };
        if capability.digest != expected_digest {
            return Err(format!(
                "capability `{}` has an untrusted digest; expected `{expected_digest}`",
                capability.id
            ));
        }
        if capability.signer != FOUNDATION_SIGNER {
            return Err(format!(
                "capability `{}` is not signed by the trusted issuer `{FOUNDATION_SIGNER}`",
                capability.id
            ));
        }
    }

    match &program.body {
        ProgramBody::Command(main) => check_command(main, &declared),
        ProgramBody::UserService(service) => check_user_service(service, &declared),
    }
}

fn trusted_digest(id: &str) -> Option<&'static str> {
    match id {
        STDOUT_ID => Some(STDOUT_DIGEST),
        HTTP_SERVER_ID => Some(HTTP_SERVER_DIGEST),
        JSON_ID => Some(JSON_DIGEST),
        SQLITE_USERS_INSERT_ID => Some(SQLITE_USERS_INSERT_DIGEST),
        _ => None,
    }
}

fn check_command(main: &Function, declared: &HashSet<&str>) -> Result<(), String> {
    let effects = unique_set(&main.effects, "effect")?;
    for effect in &effects {
        if !declared.contains(effect) {
            return Err(format!(
                "main requests effect `{effect}` without declaring its capability"
            ));
        }
    }

    let mut return_count = 0;
    let mut static_data_bytes = 0_usize;
    for statement in &main.statements {
        match statement {
            Statement::Print(value) => {
                if !effects.contains(STDOUT_ID) {
                    return Err(format!(
                        "print requires `{STDOUT_ID}` in main's effects block"
                    ));
                }
                static_data_bytes = static_data_bytes
                    .checked_add(value.len())
                    .ok_or_else(|| "static string data is too large".to_string())?;
            }
            Statement::Return(_) => return_count += 1,
        }
    }
    if static_data_bytes > MAX_STATIC_DATA_BYTES {
        return Err(format!(
            "static string data is {static_data_bytes} bytes; AIR 0.1 permits at most {MAX_STATIC_DATA_BYTES}"
        ));
    }
    if return_count != 1 || !matches!(main.statements.last(), Some(Statement::Return(_))) {
        return Err("main must end with exactly one return statement".to_string());
    }
    if declared != &effects {
        return Err("command capability declarations must exactly match main effects".to_string());
    }
    Ok(())
}

fn check_user_service(service: &UserService, declared: &HashSet<&str>) -> Result<(), String> {
    let required_capabilities = HashSet::from([HTTP_SERVER_ID, JSON_ID, SQLITE_USERS_INSERT_ID]);
    if declared != &required_capabilities {
        return Err(format!(
            "POST /users requires exactly `{HTTP_SERVER_ID}`, `{JSON_ID}`, and `{SQLITE_USERS_INSERT_ID}`"
        ));
    }

    if service.input.fields
        != vec![
            Field {
                name: "name".into(),
                type_name: "string".into(),
            },
            Field {
                name: "email".into(),
                type_name: "string".into(),
            },
        ]
    {
        return Err("POST /users input must contain `name string` and `email string`".into());
    }
    if service.output.fields
        != vec![Field {
            name: "id".into(),
            type_name: "i64".into(),
        }]
    {
        return Err("POST /users output must contain `id i64`".into());
    }
    if service.error.variants
        != [
            "invalid_json",
            "invalid_name",
            "invalid_email",
            "duplicate_email",
            "storage_failure",
        ]
    {
        return Err("POST /users error variants do not match the verified runtime contract".into());
    }

    let handler = &service.handler;
    if handler.input_type != service.input.name
        || handler.output_type != service.output.name
        || handler.error_type != service.error.name
    {
        return Err("handler input, output, or error type does not resolve".into());
    }
    if service.endpoint.method != "POST"
        || service.endpoint.path != "/users"
        || service.endpoint.handler != handler.name
    {
        return Err(
            "the first vertical slice must expose `POST /users` through its handler".into(),
        );
    }

    let effects = unique_set(&handler.effects, "effect")?;
    if effects != HashSet::from([SQLITE_USERS_INSERT_ID]) {
        return Err(format!(
            "create-user handler must request only `{SQLITE_USERS_INSERT_ID}`"
        ));
    }
    if handler.preconditions
        != [
            format!("{}.name.nonempty", handler.input_binding),
            format!("{}.email.valid", handler.input_binding),
        ]
    {
        return Err("create-user preconditions must validate non-empty name and email".into());
    }
    if handler.postconditions != ["result.id.positive"] {
        return Err("create-user postcondition must require a positive result id".into());
    }

    let insert = &handler.insert;
    if insert.capability != SQLITE_USERS_INSERT_ID
        || insert.table != "users"
        || insert.result_binding != "id"
        || insert.values
            != [
                FieldValue {
                    field: "name".into(),
                    expression: format!("{}.name", handler.input_binding),
                },
                FieldValue {
                    field: "email".into(),
                    expression: format!("{}.email", handler.input_binding),
                },
            ]
    {
        return Err("insert operation exceeds the verified `users(name,email)` contract".into());
    }

    Ok(())
}

fn unique_set<'a>(values: &'a [String], kind: &str) -> Result<HashSet<&'a str>, String> {
    let mut unique = HashSet::new();
    for value in values {
        if !unique.insert(value.as_str()) {
            return Err(format!("{kind} `{value}` is listed more than once"));
        }
    }
    Ok(unique)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CapabilityRequirement, Function, Program, ProgramBody, Statement};

    fn program() -> Program {
        Program {
            version: "0.1".into(),
            name: "hello".into(),
            capabilities: vec![CapabilityRequirement {
                id: STDOUT_ID.into(),
                digest: STDOUT_DIGEST.into(),
                signer: FOUNDATION_SIGNER.into(),
            }],
            body: ProgramBody::Command(Function {
                effects: vec![STDOUT_ID.into()],
                statements: vec![Statement::Print("hello".into()), Statement::Return(0)],
            }),
        }
    }

    #[test]
    fn accepts_an_explicit_trusted_effect() {
        check(&program()).expect("program should pass");
    }

    #[test]
    fn rejects_an_undeclared_effect() {
        let mut program = program();
        program.capabilities.clear();
        let error = check(&program).unwrap_err();
        assert!(error.contains("without declaring"), "{error}");
    }

    #[test]
    fn rejects_a_changed_capability_digest() {
        let mut program = program();
        program.capabilities[0].digest = "sha256:changed".into();
        let error = check(&program).unwrap_err();
        assert!(error.contains("untrusted digest"), "{error}");
    }
}
