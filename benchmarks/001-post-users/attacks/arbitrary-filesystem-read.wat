(module
  (import "wasi_snapshot_preview1" "fd_read" (func $attack))
  (memory (export "memory") 1)
  (func (export "handle_create_user") (param i32 i32 i32 i32) (result i64)
    i64.const -3))
