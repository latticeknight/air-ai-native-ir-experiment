# AIR MVP

## Research question

Can an LLM reliably generate non-trivial AIR programs that pass deterministic verification, request no excess authority, compile to portable Wasm, and behave correctly under a constrained host?

The MVP is successful only if it produces measured evidence for that question.
A larger language without generation and repair benchmarks would not answer it.

## Current seed

The repository now provides two executable slices:

- A command module with standard output and a Wasmtime/WASI execution path.
- A specialised `POST /users` service with records, structured errors, effects, preconditions, a postcondition boundary, direct Wasm output, HTTP/JSON boundary adapters, and real SQLite insertion.
- A hand-written parser with source-located errors.
- A checker for version, control shape, contracts, effects, flat capability declarations, descriptor digests, trusted issuers, exact table access, and endpoint shape.
- A direct WebAssembly binary emitter with no compiler runtime dependencies.
- A reference host that verifies the complete Wasm import list and embedded `air.meta` manifest before instantiation.
- Positive, negative, deterministic, adversarial, runtime, HTTP, and persistence tests.
- A frozen benchmark specification, result schema, and AIR trial runner that requires generation provenance.

## MVP scope

The first useful MVP should include:

### Language

- Fixed-width integers, booleans, strings, bytes, lists, records, variants, options, and results.
- Pure functions, local bindings, conditionals, bounded iteration, and explicit recursion policy.
- Structured errors instead of exceptions.
- Explicit function effects and resource ownership.
- Preconditions and runtime-checkable postconditions.
- A canonical binary AIR representation and lossless text form.

### Capabilities and components

- Versioned WIT-backed capability interfaces.
- Ed25519 descriptor and component signatures.
- Application-owned trust policy with explicit signer allowlists.
- Expiry and revocation checking with an offline-verifiable policy snapshot.
- A flat application capability manifest with resource constraints.
- Content-addressed, deterministic component resolution and locking.
- No lifecycle scripts and no authority gained through transitive dependency.
- WebAssembly Component Model output with a compatibility path for the seed's core Wasm target.

### Tooling

- `air fmt`, `check`, `compile`, `inspect`, and `run`.
- Stable machine-readable diagnostics for automated repair.
- A verifier independent from the main compiler implementation.
- Reproducible builds and provenance attestations.
- Wasmtime as the reference runtime with a host grant file that is separate from the source manifest.

### Evaluation

- A versioned benchmark set of at least 10 applications that were not used as prompt examples.
- Multiple model families and repeated trials with fixed sampling records.
- First-pass compile rate, repair attempts, behavioural correctness, excess-capability rate, output size, compile time, and runtime cost.
- Adversarial tasks that try to induce undeclared I/O, dependency confusion, signer substitution, and contract evasion.
- Human review of benchmark tasks, expected behaviour, and security classifications.

## Explicitly out of scope

- A new CPU backend, linker, operating system, or Wasm runtime.
- A general-purpose package registry in the npm model.
- Macros, build scripts, reflection, dynamic code loading, or ambient host access.
- A human-first syntax with extensive shorthand.
- Automatic trust in code because an LLM, registry, or another model produced it.
- Self-hosting before the language and verifier have stable semantics.

## Milestones

### M0: executable command seed

Complete.
It proves `AIR text -> parser -> checker -> Wasm -> Wasmtime/WASI` for a standard-output command.

### M1: POST /users vertical slice

Complete.
The AIR implementation, independent Rust/Wasm baseline, shared-host tests, adversarial tests, and 20-pair controlled generation experiment are complete.
The experiment found no material AIR advantage in first-pass correctness, repairability, generation cost, or effective runtime safety.
AIR remains frozen, and M2 must not begin without a new explicit decision because the current recommendation is to change direction.

### M2: signed host interaction

Add WIT-backed capabilities, real signature and revocation verification, affine resources, Component Model output, and Wasmtime host grants.
Run adversarial capability and dependency tests.

### M3: composed applications

Add signed content-addressed components, deterministic flat resolution, interface compatibility checks, and reproducible locks.
Benchmark small applications that combine pure components with two or three constrained host capabilities.

## Go or stop criteria

Continue beyond the MVP only if all of these are true:

- AIR completes at least 8 of the 10 benchmark applications.
- Capability tests have zero accepted undeclared effects.
- AIR needs fewer repair iterations than Rust/Wasm or shows another substantial reliability advantage.
- AIR retains effectively zero arbitrary transitive dependency trees.
- The same AIR application executes in at least two supported Wasm/WASI environments or architectures without source changes.
- The verifier catches meaningful errors before execution.
- AIR demonstrates at least one clear, material, measured advantage over AI-generated Rust/Wasm.
- Reproducible builds produce byte-identical artifacts across two clean environments.

The thresholds are initial hypotheses and should be frozen before running the benchmark.
Failures should lead to a design decision, not to silently changing the test set or success criteria.
