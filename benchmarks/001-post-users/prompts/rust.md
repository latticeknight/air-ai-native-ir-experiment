# Rust/Wasm target guide

Create exactly these files:

```text
candidate/Cargo.toml
candidate/src/lib.rs
```

Do not create any other candidate file.
The package name must be `candidate`.
The library crate type must be `cdylib`.
The candidate is compiled in release mode for `wasm32-wasip1` with the installed stable Rust toolchain.
The build runs offline.
Use no direct or transitive third-party dependencies, build scripts, procedural macros, included host files, or environment-dependent compilation.
The implementation must be ordinary Rust source and must satisfy `spec.md` through the ABI in `guest-abi.md`.
The resulting module may import only `air_sqlite_v1.insert_user` and must export `memory` and `handle_create_user` with the required ABI.
Ambient WASI imports are forbidden by the shared host.
Release-profile choices may be placed in `Cargo.toml`.
