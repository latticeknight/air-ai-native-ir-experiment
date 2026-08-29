# AIR benchmark methodology

Each benchmark begins with one frozen natural-language specification.
AIR, Rust/Wasm, and TypeScript/Node implementations must be generated independently from that exact specification.
Prompt context, model, sampling configuration, tool availability, time limits, test visibility, and repair opportunities must be equivalent and recorded.

No implementation may be manually improved unless the same intervention is offered to every target and recorded as a repair.
Held-out tests and adversarial cases must not be exposed during generation.

Every trial records generation and repair tokens, model calls, compilation, runtime behaviour, tests, dependencies, capability violations, artifact size, source size, and basic timing.
The shared machine-readable schema is `benchmarks/result.schema.json`.

The seed AIR runner requires generation provenance on its command line and refuses to invent it.
For example:

```sh
node benchmarks/run-air-trial.mjs \
  --trial-id model-x-run-001 \
  --generated-tokens 1200 \
  --repair-tokens 0 \
  --model-calls 1 \
  --repair-iterations 0 \
  --output target/benchmarks/model-x-run-001.json
```

The current runner covers only the AIR side of benchmark 001.
That is harness validation, not comparative evidence.
Rust/Wasm and TypeScript adapters, independent model generations, repeated trials, token telemetry, and a frozen report procedure are still required before drawing conclusions.

Benchmark thresholds must be frozen before comparative trials begin.
Negative results and unrecoverable failures remain in the result set.

