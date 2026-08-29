# AIR MVP

## Research question

Can an LLM reliably generate non-trivial AIR programs that pass deterministic verification, request no excess authority, compile to portable Wasm, and behave correctly under a constrained host?

The MVP is successful only if it produces measured evidence for that question.
A larger language without generation and repair benchmarks would not answer it.

## Current seed

The repository already provides the first executable vertical slice:

- AIR 0.1 text with one function and two statements.
- A hand-written parser with source-located errors.
- A checker for version, control shape, effects, flat capability declarations, descriptor digests, and trusted issuers.
- A direct WebAssembly binary emitter with no compiler runtime dependencies.
- A WASI standard-output import and Wasmtime CLI path.
- Positive, negative, determinism, and runtime smoke tests.
- Embedded provenance in the `air.meta` Wasm custom section.

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

- A versioned benchmark set of at least 100 tasks that were not used to design prompt examples.
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

### M0: executable seed

The current repository is M0.
It proves `AIR text -> parser -> checker -> Wasm -> WASI host` and rejects capability escalation.

### M1: useful pure programs

Add the core value model, functions, control flow, structured errors, canonical encoding, and differential tests against an independent interpreter.
Run the first LLM generation benchmark on pure transformations.

### M2: signed host interaction

Add WIT-backed capabilities, real signature and revocation verification, affine resources, Component Model output, and Wasmtime host grants.
Run adversarial capability and dependency tests.

### M3: composed applications

Add signed content-addressed components, deterministic flat resolution, interface compatibility checks, and reproducible locks.
Benchmark small applications that combine pure components with two or three constrained host capabilities.

## Go or stop criteria

Continue beyond the MVP only if all of these are true:

- At least 70 percent of held-out tasks compile within two automated repair attempts.
- At least 90 percent of compiled pure tasks pass their behavioural oracle.
- Capability tests have zero accepted undeclared effects.
- The independent verifier agrees with the compiler on every accepted benchmark artifact.
- Generated AIR is materially easier to validate or constrain than equivalent generated conventional source.
- Reproducible builds produce byte-identical artifacts across two clean environments.

The thresholds are initial hypotheses and should be frozen before running the benchmark.
Failures should lead to a design decision, not to silently changing the test set or success criteria.

