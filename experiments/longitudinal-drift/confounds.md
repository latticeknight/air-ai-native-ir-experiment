# Preregistered limitations and confounds

## What is controlled

Both pipelines use the same version-1 Rust/Wasm implementation, Cargo dependencies, Wasmtime 48.0.1 host, SQLite implementation, resource policy, HTTP envelope, model, reasoning setting, timeout, repair limit, network restriction, capability ABI, and requirement sequence.
The independent oracle evaluates both projects as black boxes against the same derived active state.

## AIR-specific treatment

The AIR pipeline has one canonical custom JSON contract and a small deterministic generator.
The conventional pipeline independently maintains OpenAPI, JSON Schema, visible test declarations, capability policy, dependency policy, and requirements documentation.
This deliberately tests central contract coherence, but it cannot establish that the benefit is unique to AIR.
A conventional workflow could instead make OpenAPI, JSON Schema, CUE, Rego, or another existing format canonical and generate the remaining artifacts.
That alternative is a central falsification question in the final report.

## Host and database

The host owns HTTP and SQLite for both guests, so this experiment does not compare Node with Rust.
The shared host creates a hidden superset schema containing every table and internal column needed across the complete sequence.
Guests can reach that schema only through exact flat imports, but the pre-existing hidden storage shape avoids migration work and understates real database-evolution complexity equally for both pipelines.

The experiment measures behavior and authority at the Wasm import boundary.
It does not attempt a second lower-level exploit campaign against Wasmtime 48.0.1.

## Model execution

The pinned Codex CLI exposes no sampling seed, maximum-output-token option, or internal inference-call count.
The runner records reported input, cached input, output, and reasoning tokens when exposed, plus logical turns and elapsed time.
Five paired chains are exploratory and may have substantial sampling variance.
The complete paired raw values are retained rather than used for formal significance claims.

Fresh model context is enforced between versions, while repairs resume only the failing version's context.
The persistent project itself carries prior intent, as intended by the hypothesis.
The current change exposes its activated and retired requirement tracking identifiers equally because the evaluator requires exact registry keys.
Revision 1 omitted those keys and was aborted rather than interpreted.
Project instructions forbid parent-directory, oracle, future-sequence, and network inspection, and executed commands are audited for violations.
The operating-system sandbox is not treated as proof that read access outside the workspace is impossible.

## Oracle construction

Requirement groups and tests were hand-authored before generation.
Retained Intent Rate therefore depends on the declared grouping and may weight a narrow rule equally with a broad behavior.
The raw per-requirement outcomes are retained so alternative weightings can be calculated later.

The oracle tests all active requirement groups and explicit obsolete behaviors at each version.
It cannot prove the absence of every possible behavioral regression.

## Repair and broken-state propagation

A failed version receives at most two repair turns.
If it remains broken, that exact project state continues to the next version.
This is faithful to accumulated maintenance drift but can produce correlated downstream failures rather than independent observations.

No human code fixes, prompt clarifications, or project resets are allowed after execution begins.
A material harness defect requires aborting this experiment and preregistering a replacement instead of editing the active protocol.

## Generalisability

The experiment covers one small users application and one fixed 20-version sequence.
It cannot establish behavior for large codebases, different domains, different models, long human-reviewed projects, or hundreds of changes.
The result answers only whether this Benchmark 001 sequence provides evidence for the longitudinal AIR-contract hypothesis.
