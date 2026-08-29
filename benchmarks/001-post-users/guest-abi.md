# Benchmark 001 guest ABI

This contract is shared by every implementation and is controlled by the benchmark harness.
It is not part of AIR or the Rust candidate.

Each candidate is a core WebAssembly module instantiated by the same Wasmtime host.
The module must export:

```text
memory: WebAssembly linear memory
handle_create_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64
```

The host writes UTF-8 `name` and `email` bytes into exported memory for the duration of the call.
The handler returns a positive generated user ID on success.
It returns these closed error codes:

```text
-1 invalid_name
-2 invalid_email
-3 storage_failure
-4 duplicate_email
```

The only permitted guest import is:

```text
module: air_sqlite_v1
name: insert_user
type: (name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64
```

That import is a table-scoped capability implemented by the shared host.
It can insert only `name` and `email` into the granted `users` table and returns the same positive-ID or negative-error convention.

Inbound HTTP, JSON decoding and encoding, database provisioning, response mapping, resource limits, and black-box tests belong to the shared host and runner.
Candidates cannot modify them.

The host rejects modules with another import, a missing export, an incompatible function type, or memory outside configured limits.
Candidates receive no filesystem, environment, outbound network, clock, random, process, or general SQLite API.

The Rust candidate must target `wasm32-wasip1` so it remains a Rust-to-Wasm/WASI candidate.
It must still avoid ambient WASI imports because they are not granted by this benchmark.
The AIR candidate remains the existing frozen compiler output.

