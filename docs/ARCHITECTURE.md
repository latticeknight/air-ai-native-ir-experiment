# AIR architecture

> Historical executable-language architecture.
> The compiler is frozen and must not be expanded.
> The later specification-layer experiment and final decision are documented in [SPECIFICATION_LAYER.md](SPECIFICATION_LAYER.md) and [the Benchmark 001 report](../reports/001-air-specification-verification.md).

## Purpose

AIR is a machine-oriented executable specification that sits above WebAssembly.
The experiment tests whether an LLM can directly generate a small, regular, verifiable representation that remains useful after compilation.

AIR owns intent-level semantics such as types, effects, contracts, capability requirements, and component composition.
WebAssembly owns portable execution.
WASI and host adapters own controlled interaction with the outside world.
Wasmtime is the initial reference runtime.

## Compiler pipeline

```text
AIR text
   |
   v
Lexer and parser
   |
   v
Typed AIR syntax tree
   |
   v
Capability and effect checker
   |
   v
Verified AIR module
   |
   v
WebAssembly encoder
   |
   v
Core Wasm module importing only approved platform functions
   |
   v
Reference host with matching grants
```

Each phase has one representation and one responsibility.
There is no hidden lowering through C, Rust, JavaScript, or another conventional source language.
The MVP emitter writes the WebAssembly binary format directly.

## Trust boundaries

AIR uses two separate gates.

The compiler gate proves that every requested effect is declared, pinned, and accepted by the compiler's trust policy.
It controls what the program is allowed to ask for.

The runtime gate decides what the current invocation actually receives.
It controls what the program can do in that environment.

Passing compilation does not imply a runtime grant.
A production host must instantiate only the imports represented by the verified manifest and must reject additional imports.

Command modules import only `wasi_snapshot_preview1.fd_write` for `wasi:stdout@1` and execute under Wasmtime.
The `POST /users` service module imports only `air_sqlite_v1.insert_user` and executes under the Node reference host, which owns inbound HTTP and JSON boundary handling.
That host verifies the module's complete import list and `air.meta` capability manifest before instantiation.

The service host is a Component Model precursor, not a completed WASI service runtime.
It demonstrates that generated Wasm receives only table-scoped insertion authority, but the trusted Node process itself is not yet sandboxed from the operating system.
A later compiler target will lower the same AIR capability to a typed WebAssembly component and versioned WASI interface without changing the source-level authority model.

## Flat capability model

A capability is a signed, versioned behavioural contract, not a library archive.
Its canonical descriptor contains at least:

- A globally unique identifier and major version.
- A typed interface digest, expected to be a WIT interface in the component target.
- A behavioural contract digest.
- Its externally observable effects and resource limits.
- The issuer public-key identifier.
- Optional expiry and revocation coordinates.

An application manifest contains the complete set of capabilities that may cross the Wasm boundary.
There are no implicit transitive capabilities.
If component A uses component B, and B needs network access, the root application must still list and grant that network capability explicitly.

```text
root application manifest
  capability wasi:stdout@1
  capability net:http-client@2 for api.example.test
  capability db:orders@1 with read,append
```

Components may depend on pure, content-addressed components.
Composition resolves code by digest, checks every interface, flattens all requested external authority, and rejects conflicts before execution.
Components cannot run install scripts or resolve new code at runtime unless a separately declared capability explicitly permits it.

## Signing and resolution

The intended resolution sequence is:

1. Parse every component descriptor without executing component code.
2. Resolve immutable content digests from configured registries or local stores.
3. Verify descriptor and content signatures against an application-owned trust policy.
4. Flatten every external capability request into one reviewable manifest.
5. Reject undeclared capabilities, incompatible major versions, expired metadata, revoked signers, and digest mismatches.
6. Write a deterministic lock containing exact component, interface, descriptor, and signer digests.
7. Compile and instantiate only from the locked content.

The lock is evidence of a resolution decision.
It is not authority by itself, and the runtime still enforces the host grant.

The prototype implements a narrower precursor.
It has built-in trust anchors for standard output, inbound HTTP serving, JSON encoding and decoding, and insertion into the `users` table.
It checks each exact canonical descriptor digest and issuer ID and rejects every other capability.
Real Ed25519 signature validation, trust-policy files, expiry, and revocation are an MVP exit requirement before third-party capabilities can run.

## Determinism and provenance

Given the same AIR input and compiler version, compilation should produce byte-identical output.
The emitted module contains an `air.meta` custom section with the AIR version, program name, and declared capability IDs.
Future locks will also record compiler, interface, contract, component, and trust-policy digests.

Time, randomness, environment variables, outbound network access, and arbitrary filesystem access are unavailable unless individually declared and granted.
Deterministic programs therefore remain deterministic by default.

## Safety invariants

- Unknown syntax is rejected.
- Unknown AIR versions are rejected.
- Unknown capabilities are rejected.
- Duplicate declarations and effects are rejected.
- A statement cannot use an effect absent from its function effect set.
- A function cannot request an effect absent from the program capability set.
- A capability digest or issuer mismatch is rejected.
- Runtime imports must be no broader than the checked capability manifest.
- External components never gain authority merely because another component depends on them.

## Future internal representations

The text form is for interchange, debugging, review, and initial LLM experiments.
The canonical representation should eventually be a versioned binary tree with stable field numbers, explicit defaults, deterministic ordering, and a canonical hash.
Text and binary forms must round-trip without semantic loss.

The compiler should preserve a proof-carrying record from source contract to lowered Wasm imports.
This does not require a general theorem prover in the first useful version.
It requires every lowering step to produce checkable evidence for the invariants it claims to preserve.
