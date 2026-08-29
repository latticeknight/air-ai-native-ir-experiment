# Benchmark 001 guest ABI

The benchmark harness controls this interface.
The candidate must compile to a core WebAssembly module.

The module must export linear memory named `memory`.
The module must export this function:

```text
handle_create_user(name_ptr: i32, name_len: i32, email_ptr: i32, email_len: i32) -> i64
```

The host writes UTF-8 `name` and `email` bytes into exported memory for the duration of the call.
The function returns a positive generated user ID on success.
It returns these error codes:

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

The import performs a prepared insertion of the supplied name and email into the granted `users` table.
It returns a positive generated ID or one of the same negative error codes.
No filesystem, environment, outbound network, clock, random, process, general database, or other import is available.
The host rejects a module with any other import or with missing or incompatible exports.
HTTP, JSON, SQLite provisioning, resource limits, and response mapping are identical benchmark-owned infrastructure outside the candidate.
