use std::collections::HashSet;

use crate::ast::{Program, Statement};

pub const STDOUT_ID: &str = "wasi:stdout@1";
pub const STDOUT_DIGEST: &str =
    "sha256:d09b856e2e70a9ad921ee7af4f22a274c3f2727c0f94193263eea4e3c3229782";
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
        match capability.id.as_str() {
            STDOUT_ID => {
                if capability.digest != STDOUT_DIGEST {
                    return Err(format!(
                        "capability `{STDOUT_ID}` has an untrusted digest; expected `{STDOUT_DIGEST}`"
                    ));
                }
                if capability.signer != FOUNDATION_SIGNER {
                    return Err(format!(
                        "capability `{STDOUT_ID}` is not signed by the trusted issuer `{FOUNDATION_SIGNER}`"
                    ));
                }
            }
            other => {
                return Err(format!(
                    "capability `{other}` is not in the compiler's trusted capability set"
                ));
            }
        }
    }

    let mut effects = HashSet::new();
    for effect in &program.main.effects {
        if !effects.insert(effect.as_str()) {
            return Err(format!("effect `{effect}` is listed more than once"));
        }
        if !declared.contains(effect.as_str()) {
            return Err(format!(
                "main requests effect `{effect}` without declaring its capability"
            ));
        }
    }

    let mut return_count = 0;
    let mut static_data_bytes = 0_usize;
    for statement in &program.main.statements {
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
    if return_count != 1 || !matches!(program.main.statements.last(), Some(Statement::Return(_))) {
        return Err("main must end with exactly one return statement".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::{CapabilityRequirement, Function, Program, Statement};

    fn program() -> Program {
        Program {
            version: "0.1".into(),
            name: "hello".into(),
            capabilities: vec![CapabilityRequirement {
                id: STDOUT_ID.into(),
                digest: STDOUT_DIGEST.into(),
                signer: FOUNDATION_SIGNER.into(),
            }],
            main: Function {
                effects: vec![STDOUT_ID.into()],
                statements: vec![Statement::Print("hello".into()), Statement::Return(0)],
            },
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
