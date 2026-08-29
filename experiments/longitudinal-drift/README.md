# Longitudinal specification-drift experiment

This directory contains the preregistered AIR longitudinal-drift experiment.
It compares a conventional Rust, OpenAPI, JSON Schema, tests, and explicit-policy workflow with the same Rust/Wasm project maintained through one canonical AIR JSON contract.

The experiment starts from the same hand-authored Benchmark 001 implementation in both pipelines.
Five independent chains per pipeline receive the same 19 sequential changes after the version-1 control.
Every version uses a fresh model context, and a failed version may receive at most two repair turns in that version's context.

## Boundary

This is not Benchmark 002.
AIR is not executable in this experiment.
The AIR compiler, parser, verifier, language, package model, and previous conclusions remain frozen.

## Files

- `protocol.json` freezes execution controls and materiality thresholds.
- `requirements.json` freezes the complete 20-version sequence and flat capability catalogue.
- `drift-taxonomy.md` defines measured drift categories.
- `oracle/` is the independent black-box evaluator and derived-state implementation.
- `templates/` contains the identical Rust/Wasm control plus pipeline-specific project artifacts.
- `../../docs/drift-hypothesis.md` contains the hypothesis and decision rule.

The model workspace receives the control project, its pipeline instructions, and only the current change in `CHANGE.md`.
The current change includes its activated and retired requirement tracking identifiers because both project registries are scored against those exact keys.
It cannot see future changes or the independent oracle through the experiment prompt.

Protocol revision 1 was aborted before version 3 because it omitted those required identifiers from the model input.
Its partial outputs are preserved under `results/001-post-users/longitudinal-drift/preregistered-v1/` and are not experimental evidence.
Revision 2 changes only that neutral input-completeness defect.

## Reproduce

Install the repository's pinned Rust toolchain, Node.js, and Codex CLI version recorded in `protocol.json`.
Build and check the controls before running model calls:

```sh
cargo build --release --locked --manifest-path benchmark-runner/Cargo.toml --bin air-longitudinal-host
node experiments/longitudinal-drift/oracle/state.test.mjs
node experiments/longitudinal-drift/oracle/calibration.test.mjs
node benchmark-runner/longitudinal-drift/protocol.test.mjs
```

Run the preregistered five paired chains:

```sh
node benchmark-runner/longitudinal-drift/run.mjs
node benchmark-runner/longitudinal-drift/report.mjs
```

For operational recovery, `--only baseline:1` selects one pipeline and chain, while `--through-version 10` stops after a chosen version without changing the protocol.
Completed versions are resumed from private local state and are not regenerated.

Public results are written under `results/001-post-users/longitudinal-drift/`.
Codex thread identifiers, resumable session state, isolated workspaces, and unsanitized event streams stay under ignored `.private/` storage.
