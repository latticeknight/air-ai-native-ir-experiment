# Benchmark 001 controlled generation protocol

This protocol is frozen before controlled AIR and Rust generation trials begin.
Its purpose is to separate language effects from prompt, model, tooling, repair, and evaluator effects.

## Trial isolation

Each trial starts in a new empty candidate directory.
The model receives the unchanged benchmark specification, the shared guest ABI, and one language-specific toolchain appendix.
The Rust trial must not receive the AIR implementation, compiler source, diagnostics from AIR trials, or prior Rust candidates.
The AIR trial must not receive the Rust implementation, diagnostics from Rust trials, or prior AIR candidates.
Held-out functional cases and attack fixtures remain unavailable to both generators.

## Controlled variables

The paired AIR and Rust runs use the same model identifier, reasoning setting, system environment, wall-clock limit, context-window policy, tool availability, sandbox, repair budget, and fresh-context policy.
AIR runs go first in odd-numbered pairs and Rust runs go first in even-numbered pairs.
The installed Codex CLI does not expose a sampling seed or per-turn maximum output-token flag, so those controls are recorded as unavailable and both targets use identical defaults.
The language-specific appendix may contain only information intrinsically required to generate that target.
AIR requires an explicit grammar, capability digest set, and narrow verifier contract because the model has no pretrained AIR knowledge.
Rust receives only its file, toolchain, dependency, and ABI constraints.
Every difference between appendices must be retained with the raw trial record.

## Repair loop

Each trial permits at most three automated repairs.
The only feedback is the exact compiler, verifier, host-start, or black-box test diagnostic produced by the independent harness.
The loop is generate, compile or check, return diagnostics, and repair.
No human edits are permitted.
Every candidate version, model response, diagnostic, token count, and elapsed time must be retained, including unrecoverable failures.

## Initial sample

Run 20 independent trials for each language with paired and alternating ordering.
Do not stop early because one target appears ahead.
Do not remove syntax-valid but behaviourally wrong programs.
Do not change AIR, the Rust appendix, the shared host, the tests, or the report rules during the sample.

## Required telemetry

Each Codex turn must record input tokens, cached input tokens, output tokens, reasoning output tokens, wall-clock time, thread identity, and requested model identity from CLI telemetry.
The CLI does not expose the number of internal inference calls inside one agent turn, so the report counts logical generation and repair turns and marks internal model calls unavailable.
Each trial must record first-pass compile, runtime, and full-test success separately from eventual success.
The final candidate is evaluated by the same functional and security harness used for the engineering baseline.
Records must conform to `benchmarks/generation-trial.schema.json`.

## Completed sample

Experiment `b001-gpt-5-6-luna-medium-r20-v2` completed 20 controlled AIR trials and 20 controlled Rust/Wasm trials.
The complete raw candidates, diagnostics, evaluator results, JSONL event streams, and exact per-turn usage telemetry are retained under `results/001-post-users/generation/b001-gpt-5-6-luna-medium-r20-v2/`.
The statistical comparison is `reports/001-ai-generation-b001-gpt-5-6-luna-medium-r20-v2.md`.
An earlier calibration sample was excluded before this experiment began because resumed repair turns were incorrectly read-only.
No calibration result is included in the official sample or its metrics.

## Frozen decision thresholds

A first-pass full-success difference of at least 15 percentage points is material.
A difference of at most 10 percentage points is a tie.
An average repair-count difference of at least 0.5 is material, and a difference of at most 0.25 is a tie.
A reported-token-per-success difference of at least 20 percent is material, and a difference of at most 10 percent is a tie.
Source representation differs materially at 20 percent.
All other differences are reported as inconclusive rather than forced into a winner.
