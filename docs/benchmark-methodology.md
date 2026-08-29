# AIR comparative benchmark methodology

The benchmark infrastructure is independent of the AIR parser, verifier, compiler, and candidate implementations.
Each benchmark begins with one frozen, implementation-neutral specification and one benchmark-owned guest ABI.
Both candidates run in the same shared Wasmtime host with identical resource limits, HTTP and JSON handling, SQLite implementation, external cases, and adversarial import probes.

## Engineering baselines

An engineering baseline validates the harness and establishes functional, safety, simplicity, artifact, build, and local runtime measurements.
It is not evidence about AI-generation reliability unless both candidates were generated under a controlled same-model protocol with captured telemetry.
Unavailable token, model-call, and repair metrics remain explicit null values.

Run Benchmark 001 from the repository root:

```sh
BENCHMARK_ITERATIONS=5 node benchmark-runner/run.mjs
```

The command rebuilds both guests and the shared host, alternates target order across five black-box runs, executes the attack suite, retains raw JSON, writes aggregate JSON, and regenerates the report.
The aggregate files conform to `benchmarks/result.schema.json`.

## Controlled generation trials

AIR and Rust implementations must be generated independently from the exact same natural-language specification.
Prompt context, model, sampling configuration, tool availability, time limits, test visibility, and repair opportunities must be equivalent and recorded.
The Rust generator must never receive the AIR implementation.
The frozen procedure is `benchmarks/001-post-users/generation-protocol.md`.
Individual generation records conform to `benchmarks/generation-trial.schema.json`.

No implementation may be manually improved unless the same intervention is offered to every target and recorded as a repair.
Held-out tests and adversarial cases must not be exposed during generation.
At most three automated repair attempts are permitted.
Negative results, behaviourally incorrect programs, and unrecoverable failures remain in the result set.

## Interpretation

Candidate dependency counts exclude the identical shared host and report its dependency graph separately.
Performance results retain all samples and report medians and means where useful.
The local HTTP measurements include the common HTTP, JSON, Wasmtime, and SQLite costs, so small differences must not be treated as language rankings.
The report must answer the falsification question and may conclude YES, NO, or INCONCLUSIVE.
