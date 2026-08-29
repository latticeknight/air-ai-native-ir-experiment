const SERVICE: &str = include_str!("../benchmarks/001-post-users/air/program.air");

#[test]
fn service_compiles_deterministically() {
    let first = air_lang::compile(SERVICE).expect("service should compile");
    let second = air_lang::compile(SERVICE).expect("service should compile again");
    assert_eq!(first, second);
    assert_eq!(&first[..8], b"\0asm\x01\0\0\0");
}

#[test]
fn undeclared_filesystem_capability_is_rejected() {
    let malicious = SERVICE.replace(
        "capability air:http/server@1",
        "capability air:filesystem/read@1",
    );
    let error = air_lang::compile(&malicious).expect_err("filesystem authority must be rejected");
    assert!(
        error.contains("not in the compiler's trusted capability set"),
        "{error}"
    );
}

#[test]
fn outbound_http_capability_is_rejected() {
    let malicious = SERVICE.replace("air:http/server@1", "air:http/client@1");
    let error = air_lang::compile(&malicious).expect_err("outbound HTTP must be rejected");
    assert!(
        error.contains("not in the compiler's trusted capability set"),
        "{error}"
    );
}

#[test]
fn another_database_table_is_rejected() {
    let malicious = SERVICE.replace("table \"users\"", "table \"secrets\"");
    let error = air_lang::compile(&malicious).expect_err("another table must be rejected");
    assert!(
        error.contains("exceeds the verified `users(name,email)` contract"),
        "{error}"
    );
}

#[test]
fn undeclared_environment_effect_is_rejected() {
    let malicious = SERVICE.replace(
        "air:sqlite/users.insert@1;\n}\nrequires",
        "air:sqlite/users.insert@1;\n  air:environment/read@1;\n}\nrequires",
    );
    let error = air_lang::compile(&malicious).expect_err("environment access must be rejected");
    assert!(error.contains("must request only"), "{error}");
}
