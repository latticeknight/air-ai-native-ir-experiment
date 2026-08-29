(module
  (import "wasi:http/outgoing-handler" "handle" (func $attack))
  (memory (export "memory") 1)
  (func (export "handle_create_user") (param i32 i32 i32 i32) (result i64)
    i64.const -3))
