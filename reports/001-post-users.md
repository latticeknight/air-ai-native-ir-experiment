# Benchmark 001: AIR vs Rust/Wasm

## Conclusion

**Does Benchmark 001 currently provide evidence that AIR is meaningfully better than Rust/Wasm?**

**INCONCLUSIVE**

Both engineering baselines passed every functional case and every shared runtime capability attack.
AIR adds earlier source-level rejection for the tested undeclared capabilities and emits a smaller module, but those results do not establish better AI-generation reliability, lower token cost, or a uniquely safer deployed system.
The required controlled same-model generation trials have not yet been run, so the central experimental claim cannot be decided honestly.

## Results

| Measure | AIR | Rust/Wasm |
|---|---:|---:|
| Full black-box runs passed | 100% | 100% |
| Functional assertions passed | 60/60 | 60/60 |
| Undeclared accesses succeeded | 0/8 | 0/8 |
| Wasm artifact | 458 bytes | 1481 bytes |
| Candidate direct dependencies | 0 | 0 |
| Candidate transitive dependencies | 0 | 0 |
| Generated representation | 1108 bytes | 3581 bytes |
| Candidate build time | 467.82 ms | 132.53 ms |
| Median of median request latency | 0.5 ms | 0.55 ms |
| Mean throughput | 3325.26 req/s | 3046.89 req/s |
| Median cold start | 7.39 ms | 8.14 ms |
| Median peak resident memory | 10076160 bytes | 11190272 bytes |

All 5 measured runs for each target are retained under `results/001-post-users/raw/`.
There were no omitted functional failures because there were no observed failures in these engineering baselines.
The latency and throughput numbers are initial local measurements, not statistically stable rankings.

## Safety outcome

AIR rejected all eight mutated source probes during AIR verification.
The shared host also rejected all eight forbidden-import modules before instantiation for both targets.
Rust itself did not structurally forbid writing source that requests another import, but that import could not be linked or executed in the shared environment.
Both deployed candidates received exactly one effective guest import: a prepared, table-scoped `users(name,email)` insertion function.
No filesystem, environment, outbound HTTP, general SQLite, clock, random, or process API was linked.

| Attack | AIR earliest stop | Rust/Wasm earliest demonstrated stop |
|---|---|---|
| read-etc-passwd | air_verification | runtime_capability_boundary |
| arbitrary-filesystem-read | air_verification | runtime_capability_boundary |
| arbitrary-filesystem-write | air_verification | runtime_capability_boundary |
| environment-variable-access | air_verification | runtime_capability_boundary |
| outbound-http | air_verification | runtime_capability_boundary |
| undeclared-sqlite-table | air_verification | runtime_capability_boundary |
| undeclared-database | air_verification | runtime_capability_boundary |
| undeclared-capability | air_verification | runtime_capability_boundary |

The Rust source column is deliberately limited to the stage actually tested.
A synthetic forbidden-import corpus tested the shared runtime boundary, while controlled generated malicious Rust source trials remain future work.

## Falsification test

For Benchmark 001, the answer appears to be **yes**: best-practice Rust plus Wasmtime and the same narrow capability API reproduced AIR's effective runtime capability safety without introducing AIR.
AIR's verifier stopped the tested requests earlier and its module was 69 percent smaller, but neither fact yet demonstrates a substantial end-to-end advantage.
This is evidence against claiming a unique AIR safety advantage from the first vertical slice.

## Dependency and deployment surface

Both candidate guests have zero package dependencies and one effective runtime import.
AIR declares three signed capabilities at source level because inbound HTTP and JSON are part of its representation, while the neutral ABI places those shared concerns in the host for both candidates.
The Rust guest has three build configuration files and uses Cargo plus rustc.
The AIR guest is one source file and uses the AIR compiler.
The shared host has 5 direct and 127 transitive Rust package dependencies, but that identical cost is excluded from both candidate counts.

## AI-generation reliability

No comparable percentage, mean, median, token total, or repair distribution exists yet.
The AIR program predates this controlled comparison, and the independent Rust baseline was generated without captured token telemetry.
They are therefore engineering baselines only, not the requested 20-run stochastic experiment.
The frozen protocol and schema in `benchmarks/001-post-users/generation-protocol.md` and `benchmarks/generation-trial.schema.json` allow those runs to be added without changing success criteria.

## Confounding factors

- Node.js is used only as the black-box test orchestrator and independent SQLite inspector.
- Neither candidate executes inside the previous Node reference host.
- Both candidates run as core Wasm modules in the same Wasmtime 48.0.1 process with the same HTTP adapter, JSON handling, bundled SQLite implementation, database schema, fuel budget, memory limit, and test requests.
- The Rust module targets `wasm32-wasip1` but imports no ambient WASI functions because none are granted.
- SQLite is not a standardized WASI Preview 1 interface, so the table-scoped import is benchmark-owned and identical for both guests.
- The shared host handles requests serially.
- The concurrent-insert test therefore checks concurrent external arrival and correctness under queuing, not parallel guest execution.
- Build timings use a fresh Rust candidate target directory, while AIR uses an already-built compiler executable to emit a fresh module.
- The local performance sample is small, uses one machine, and combines HTTP, JSON, Wasmtime, and SQLite overhead.
- Only one implementation per language exists, so implementation quality and generation variance are not separable from language effects.

## What the result does and does not say

Benchmark 001 currently shows that AIR can satisfy the contract with earlier verifier rejection and a compact artifact.
It also shows that a zero-dependency Rust guest behind the same narrow host boundary can satisfy the same contract and block the same deployed attacks.
It does not yet show that AIR is more reliable or cheaper for an LLM to generate.
AIR must remain frozen until the controlled generation experiment is run or this milestone is explicitly closed as inconclusive.

## Implementation references

The shared host uses Wasmtime's explicit [Linker](https://docs.rs/wasmtime/latest/wasmtime/struct.Linker.html) boundary and [StoreLimitsBuilder](https://docs.rs/wasmtime/latest/wasmtime/struct.StoreLimitsBuilder.html) resource limits.
SQLite access uses the [rusqlite](https://docs.rs/rusqlite/latest/rusqlite/) embedding library with a benchmark-owned prepared insert.
