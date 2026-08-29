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

The paired AIR and Rust runs must use the same model identifier, model revision, sampling parameters, system instruction, token budget, wall-clock budget, context-window policy, tool availability, and generation order randomisation.
The language-specific appendix may name only the required compiler command, target, source file location, and guest ABI mapping.
Every difference between appendices must be retained with the raw trial record.

## Repair loop

Each trial permits at most three automated repairs.
The only feedback is the exact compiler, verifier, host-start, or black-box test diagnostic produced by the independent harness.
The loop is generate, compile or check, return diagnostics, and repair.
No human edits are permitted.
Every candidate version, model response, diagnostic, token count, and elapsed time must be retained, including unrecoverable failures.

## Initial sample

Run 20 independent trials for each language with paired and randomised ordering.
Do not stop early because one target appears ahead.
Do not remove syntax-valid but behaviourally wrong programs.
Do not change AIR, the Rust appendix, the shared host, the tests, or the report rules during the sample.

## Required telemetry

Each model call must record input tokens, output tokens, generation time, finish reason, and model identity from provider telemetry.
Each trial must record first-pass compile, runtime, and full-test success separately from eventual success.
The final candidate is evaluated by the same functional and security harness used for the engineering baseline.
Records must conform to `benchmarks/generation-trial.schema.json`.

## Deferred status

The current repository contains zero controlled generation trials.
The existing AIR and independent Rust implementations are engineering baselines because their generation telemetry and matched context are unavailable.
