# AIR research decisions

AIR began as an experiment in direct AI generation of a machine-oriented implementation language.
Benchmark 001 found no material generation-reliability, repairability, generation-efficiency, or runtime-safety advantage over Rust/Wasm.
That hypothesis was stopped.

AIR then became a declarative specification, capability, and verification experiment above generated Rust/Wasm.
The contract generated a Wasmtime runtime policy and derived static and dynamic checks.
It detected all 14 seeded compiling faults while the existing baseline detected 8.

An ordinary augmented stack using OpenAPI and JSON Schema concepts, Cargo metadata policy, a manual Wasmtime manifest, and five additional integration cases also detected all 14 faults.
The AIR manifest and manual runtime manifest enforced the same authority boundary.
AIR reduced per-application policy fragmentation, but that drift-resistance benefit did not outweigh its custom schema and verifier tooling.

The final decision is **NOT PROMISING**.
The recommendation is **STOP**.
AIR-specific language, contract, verifier, component, and benchmark expansion must not continue without a new explicitly approved research question and evidence that standard tooling cannot answer it.
