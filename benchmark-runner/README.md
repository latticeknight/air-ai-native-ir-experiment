# Benchmark runner

This directory contains the benchmark-owned execution environment and black-box evaluators.
It is deliberately separate from AIR and both candidate implementations.

The Rust host embeds Wasmtime 48.0.1 and exposes one table-scoped SQLite insertion import.
It supplies no ambient WASI filesystem, environment, network, clock, random, or process interfaces.
Both candidates receive the same 4 MiB memory limit, ten million fuel units per request, HTTP adapter, JSON handling, SQLite connection, and error mapping.

Run the complete engineering baseline from the repository root:

```sh
BENCHMARK_ITERATIONS=5 node benchmark-runner/run.mjs
```

The runner creates:

```text
results/001-post-users/raw/                  Per-execution functional and security JSON
results/001-post-users/engineering-air.json  AIR aggregate
results/001-post-users/engineering-rust-wasm.json
results/001-post-users/comparison.json
reports/001-post-users.md                     Human-readable comparison
```

Node.js orchestrates the tests and independently inspects the final SQLite database.
It is not the execution host for either candidate.
