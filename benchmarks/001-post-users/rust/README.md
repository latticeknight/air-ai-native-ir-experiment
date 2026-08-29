# Rust candidate

This candidate is a dependency-free `no_std` Rust library compiled as a core WebAssembly module for `wasm32-wasip1`.
It validates the supplied UTF-8 name and the benchmark's exact byte-level email rule, then calls the single table-scoped `air_sqlite_v1.insert_user` host import.
The checked-in toolchain file pins Rust and installs the required target.

## Build

Build the reproducible release artifact:

```sh
cargo build --release --locked --target wasm32-wasip1
```

The module is written to:

```text
target/wasm32-wasip1/release/benchmark_001_post_users_rust.wasm
```

Run the native validation unit tests with:

```sh
cargo test --locked
```
