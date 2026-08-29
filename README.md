# AIR - AI-Native IR Experiment

> **Status: Completed research experiment - development stopped after falsification tests.**

AIR investigated whether software generated and maintained by AI would benefit from a machine-first portable representation instead of a conventional implementation language.
The executable language was built, tested against Rust/Wasm, redirected toward specification-driven verification, and then stopped when ordinary tooling reproduced its measured advantages with less custom infrastructure.

The final result is negative:

> AIR demonstrated that an AI-native intermediate representation is technically feasible, but the experiments did not demonstrate sufficient advantage over AI-generated Rust/Wasm and existing verification tooling to justify creating and maintaining a new language and compiler ecosystem.

This repository is a completed research archive, not a production language, security product, or request for contributors to continue AIR development.
It preserves the working prototype, frozen benchmark, generated candidates, adversarial tests, mutation experiment, raw evidence, and the results that falsified the hypothesis.

## Question

> If AI increasingly writes and maintains software, do we still need to use programming languages designed primarily for humans?

The initial hypothesis was:

> An AI-targeted portable representation might allow generated software to be safer, simpler, more reliable, and less dependent on conventional package ecosystems than generated high-level source code.

AIR was deliberately compared with Rust compiled to WebAssembly/WASI.
Comparing only with JavaScript or Python would not have tested whether AIR added value beyond an existing memory-safe language and a capability-constrained runtime.

## Initial architecture

```text
Natural-language specification
        |
        v
       AI
        |
        v
       AIR
        |
        v
parser / type checker / capability verifier
        |
        v
WebAssembly / WASI
        |
        v
Wasmtime
        |
        v
ARM / x86 / other targets
```

AIR was intended to provide:

- A machine-first representation.
- Explicit capabilities and effects.
- Contracts and invariants.
- Deterministic validation and byte-stable compilation.
- No arbitrary transitive package or authority trees.
- Portable WebAssembly execution.
- A minimal runtime surface.

The compiler emits WebAssembly directly.
It does not lower AIR through Rust, C, JavaScript, or another conventional source language.

## Milestone 1 - Vertical slice

The first working slice implemented `POST /users` with JSON input, name and email validation, SQLite persistence, generated IDs, and structured errors.
The guest received only table-scoped insertion authority.
It received no arbitrary filesystem, environment, outbound HTTP, or unrelated database-table access.

Observed results:

- Real HTTP, JSON, Wasm, and SQLite execution worked end to end.
- Compiler and HTTP persistence tests passed.
- Forbidden capabilities were rejected.
- Compilation produced a deterministic 458-byte Wasm artifact.
- The AIR guest had zero direct or transitive package dependencies.

This milestone established feasibility only.
It did not establish superiority over Rust/Wasm.

## Experiment 1 - AIR vs Rust/Wasm

AIR language development was frozen before the comparison so that poor results could not be repaired by tuning AIR around the benchmark.
Both implementations ran in the same Wasmtime 48.0.1 host with the same HTTP adapter, JSON handling, SQLite implementation, capability boundary, resource limits, and external tests.

| Result | AIR | Rust/Wasm |
|---|---:|---:|
| Functional assertions | 60/60 | 60/60 |
| Undeclared-capability attacks blocked | 8/8 | 8/8 |
| Wasm artifact | 458 bytes | 1,481 bytes |
| Guest transitive dependencies | 0 | 0 |

AIR rejected the tested undeclared capabilities earlier during verification.
Rust plus the same narrow Wasmtime capability API reproduced AIR's effective runtime security.

**Conclusion: INCONCLUSIVE.**

The unresolved question was whether AI could generate AIR more reliably or efficiently than Rust/Wasm.
See the [engineering comparison report](reports/001-post-users.md).

## Experiment 2 - Controlled AI generation

The same model generated implementations independently from equivalent contexts and the same benchmark specification.
The protocol used fresh sessions, 20 AIR generations, 20 Rust generations, at most three automated repairs, no human code fixes, and complete failure accounting.
Invalid calibration samples were excluded before the final 20-pair experiment.

| Result | AIR | Rust/Wasm |
|---|---:|---:|
| First-pass fully correct | 17/20 | 17/20 |
| Fully correct after repair | 20/20 | 20/20 |
| Mean repair iterations | 0.20 | 0.15 |
| Successful undeclared accesses | 0 | 0 |
| Reported tokens per correct output | 86,967.6 | 99,109.15 |
| Median successful source size | 1,068 bytes | 2,187 bytes |
| Median successful Wasm size | 460 bytes | 2,047 bytes |

AIR used approximately 12.3 percent fewer reported tokens per successful output.
That difference was below the predefined 20 percent materiality threshold.
Reliability, repairability, and effective safety were ties, while AIR produced substantially smaller representations and artifacts.

**Conclusion: INCONCLUSIVE.**

**Recommendation at this stage: CHANGE DIRECTION.**

> Benchmark 001 provided no positive evidence that AIR justified introducing another implementation language and compiler layer.

See the [controlled-generation report](reports/001-ai-generation-b001-gpt-5-6-luna-medium-r20-v2.md).

## Experiment 3 - AIR as a specification layer

The project then tested a narrower hypothesis:

```text
Natural-language intent
        |
        v
AIR specification
        |
        v
AI-generated Rust
        |
        v
AIR verification
        |
        v
Rust/Wasm
        |
        v
Wasmtime
```

AIR was reduced to contracts, capabilities, invariants, effects, dependency constraints, and verification metadata.
No executable AIR language features were added during this pivot.

Fourteen deliberately faulty but compiling Rust/Wasm implementations were tested.
AIR initially detected 14/14, while the existing baseline detected 8/14.
The ordinary baseline was then strengthened with five integration cases, Cargo dependency policy, OpenAPI 3.1, JSON Schema 2020-12, and the existing Wasmtime capability controls.
The strengthened ordinary baseline also detected 14/14.
Both approaches produced zero false positives against the correct control.

| Dimension | Result |
|---|---|
| Capability configuration | AIR advantage |
| Contract-derived verification | Baseline equivalent |
| Seeded-defect detection | Baseline equivalent |
| Manual verification complexity | Baseline advantage |
| Specification-to-implementation drift resistance | AIR advantage |
| Overall | **NOT PROMISING** |
| Recommendation | **STOP** |

AIR's generated capability manifest improved configuration coherence and reduced drift risk.
It did not provide enough unique verification capability to justify a custom schema, parser, validator, test generator, verifier, and long-term ecosystem maintenance.
See the [final specification-layer report](reports/001-air-specification-verification.md).

## Final conclusion

The original implementation-language hypothesis was not supported strongly enough to continue.
The original intuition appears stronger when applied to machine-verifiable specifications rather than to a new implementation language.

A pragmatic future architecture can use existing standards:

```text
Human intent
    |
    v
AI
    |
    v
existing machine-readable contracts
    |-- OpenAPI
    |-- JSON Schema
    |-- capability policies
    |-- property and integration tests
    |-- dependency policies
    `-- invariants
    |
    v
AI-generated implementation
    |
    v
automated verification
```

## Why publish a negative result?

Stopping was an intended possible outcome.
The project defined materiality thresholds and kill criteria before benchmarking, froze AIR before comparison, retained failed generations, and explicitly attempted to falsify the hypothesis.

The archive is useful because it contains:

- A working language and compiler prototype.
- A reproducible shared-host comparison.
- Controlled AI-generation trials.
- Adversarial capability tests.
- A compiling-mutation experiment.
- Machine-readable raw results and summaries.
- An explicit negative conclusion.

This is a completed experiment whose hypothesis was not supported strongly enough to justify further development.

## Repository map

```text
capabilities/        Trusted capability descriptors used by AIR 0.1
src/                 Parser, checker, compiler API, CLI, and Wasm emitter
runtime/             Historical HTTP, JSON, and SQLite reference host
verification/        Frozen AIR contract and derived-check prototype
benchmarks/          Specification, candidates, attacks, mutations, and schemas
benchmark-runner/    Shared Wasmtime host and independent evaluators
results/             Raw evidence, generated candidates, and JSON summaries
reports/             Human-readable comparisons and final conclusions
docs/                Architecture, scope, methodology, and research decisions
tests/               Compiler, adversarial, Wasm, and service tests
```

The layout preserves the actual experiment rather than reorganising it into a cleaner but less reproducible shape.

## Reproduce the experiment

### Requirements

- Rust 1.96.0 with the `wasm32-wasip1` target.
- Node.js 24.12.0 or a compatible Node.js 24 release with built-in SQLite support.
- The Rust crates locked in the committed `Cargo.lock` files, including Wasmtime 48.0.1.
- A POSIX-like environment for the recorded shell-level orchestration.
- The Codex CLI and an authenticated OpenAI/Codex account only when repeating the controlled AI-generation phase.

The comparative benchmarks use the embedded Wasmtime crate and do not require a separate `wasmtime` executable.
The optional historical `air run` command does require a `wasmtime` CLI on `PATH`.

Install the pinned Rust target:

```sh
rustup toolchain install 1.96.0 --profile minimal --target wasm32-wasip1
```

Run compiler and contract tests:

```sh
cargo test --locked
```

Build the frozen Benchmark 001 AIR artifact:

```sh
cargo run --locked -- build benchmarks/001-post-users/air/program.air -o target/post-users.wasm
wc -c target/post-users.wasm
```

The byte count should be `458`.

Run the full AIR versus Rust/Wasm engineering benchmark and regenerate its JSON and Markdown report:

```sh
BENCHMARK_ITERATIONS=5 node benchmark-runner/run.mjs
```

Run the mutation experiment and regenerate its report:

```sh
node benchmark-runner/verification-experiment/run.mjs
node benchmark-runner/verification-experiment/report.mjs
```

Regenerate the controlled AI-generation report from the committed, sanitised run records without making model calls:

```sh
node benchmark-runner/ai-generation/report.mjs \
  --experiment-id b001-gpt-5-6-luna-medium-r20-v2 \
  --runs 20 \
  --max-repairs 3 \
  --model gpt-5.6-luna \
  --reasoning medium
```

Repeating the generation itself requires the Codex CLI, authentication, access to the recorded model, and materially more time and token usage:

```sh
node benchmark-runner/ai-generation/run.mjs \
  --experiment-id your-new-experiment-id \
  --runs 20 \
  --max-repairs 3 \
  --model gpt-5.6-luna \
  --reasoning medium
```

Use a new experiment ID so the committed historical evidence remains unchanged.
Fresh generation telemetry contains local session identifiers and is ignored by the public-repository rules until reviewed and sanitised.

## Evidence integrity and publication safety

The committed results preserve every candidate, attempt outcome, token count, test result, failure classification, aggregate, and report used for the conclusions.
Before public release, the complete Git history was scanned for credentials and private data.
Codex thread identifiers and machine-specific temporary-directory prefixes were replaced with explicit neutral placeholders throughout history.
No benchmark measurements or conclusions were changed.

See [publication security and evidence notes](docs/publication-security.md) for the exact boundary.

## Further reading

- [Original hypothesis and kill criteria](docs/original-hypothesis.md)
- [Historical executable architecture](docs/ARCHITECTURE.md)
- [AIR 0.1 language scope](docs/LANGUAGE.md)
- [Capability model](docs/capability-model.md)
- [Benchmark methodology](docs/benchmark-methodology.md)
- [Specification-layer scope](docs/SPECIFICATION_LAYER.md)
- [Final conclusions](docs/final-conclusions.md)
- [Engineering comparison report](reports/001-post-users.md)
- [Controlled-generation report](reports/001-ai-generation-b001-gpt-5-6-luna-medium-r20-v2.md)
- [Specification-layer falsification report](reports/001-air-specification-verification.md)

## License

The repository retains its original [MIT License](LICENSE).
The dependency-license review is documented in [docs/licensing.md](docs/licensing.md).
