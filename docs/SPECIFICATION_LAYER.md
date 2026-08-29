# AIR specification and verification layer

## Decision

AIR is no longer an implementation language.
The executable AIR prototype remains frozen as historical experimental evidence.
New work must treat ordinary Rust/Wasm as the generated implementation and AIR as a declarative source of truth for verification.

The Benchmark 001 prototype tested that direction and has now reached its kill condition.
AIR found six faults missed by the existing baseline, but five ordinary integration cases and one Cargo metadata policy reproduced all six detections.
The specification-layer prototype is therefore frozen with a **NOT PROMISING** conclusion and **STOP** recommendation.

The intended flow is:

```text
Natural-language intent
        |
        v
AIR contract
        |
        +--> runtime capability manifest --> Wasmtime host
        |
        +--> static implementation checks
        |
        `--> derived dynamic checks
                 |
                 v
        generated Rust --> Wasm/WASI
```

## Allowed scope

An AIR contract may describe endpoints, data shapes, named validation predicates, outcomes, effects, capabilities, postconditions, invariants, dependency limits, and resource limits.
Every rule must map to a documented static check, dynamic check, generated runtime policy, or explicit unsupported diagnostic.
The contract must remain data, not executable application source.

The first prototype uses canonical JSON because deterministic parsing, hashing, signing, and validation matter more than a new surface syntax.
JSON is not claimed as an AIR advantage.
It deliberately exposes whether the useful result is merely a well-organised schema plus ordinary verification tools.

## Prohibited scope

AIR contracts must not acquire loops, recursion, general-purpose control flow, arbitrary expressions, mutable variables, implementation algorithms, dynamic code loading, or package build logic.
Adding those features would recreate the rejected implementation-language direction.

## Guarantee classes

Static checks run before candidate execution.
They cover contract structure, known rule vocabulary, Wasm import allowlists, capability-to-effect consistency, dependency limits, ABI exports, and resource-manifest validity.

Dynamic checks execute generated requests and inspect externally visible results and database state.
They cover input predicates, status and response postconditions, required database effects, uniqueness, storage-failure mapping, and similar behavioral rules.
Dynamic checks are tests derived from a contract.
They are not formal proofs.

Runtime enforcement is provided by Wasmtime and the host capability implementation.
AIR only supplies the allowlist and resource configuration used to construct that boundary.

## Research question

The active question is whether one compact contract materially improves verification over Rust types, OpenAPI and JSON Schema, Cargo policy, ordinary tests, and an explicit Wasmtime capability policy.
If those ordinary tools reproduce the same detection with similar complexity, AIR should not continue as custom infrastructure.

Benchmark 001 remains the only benchmark in scope for this milestone.

## Final evidence

The contract generated an enforcement-equivalent runtime manifest and 13 static or dynamic rule classes.
Fourteen deliberately faulty Rust/Wasm implementations compiled successfully.
The existing baseline detected 8, AIR verification detected 14, and the augmented ordinary baseline detected 14.
The full evidence is in [the specification-layer report](../reports/001-air-specification-verification.md).
