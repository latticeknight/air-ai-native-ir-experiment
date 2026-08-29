const HELLO: &str = include_str!("../examples/hello.air");
const REJECTED: &str = include_str!("../examples/rejected-ambient-output.air");

#[test]
fn checked_input_compiles_deterministically() {
    let first = air_lang::compile(HELLO).expect("example should compile");
    let second = air_lang::compile(HELLO).expect("example should compile again");
    assert_eq!(first, second);
    assert_eq!(&first[..8], b"\0asm\x01\0\0\0");
}

#[test]
fn ambient_output_is_rejected() {
    let error = air_lang::compile(REJECTED).expect_err("ambient output must fail closed");
    assert!(error.contains("print requires `wasi:stdout@1`"), "{error}");
}
