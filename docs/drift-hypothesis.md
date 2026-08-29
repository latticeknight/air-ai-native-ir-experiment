# AIR longitudinal drift hypothesis

## Scope

This document preregisters one additional AIR experiment.
It does not reopen AIR as an implementation language and does not alter any previous result or threshold.
The executable AIR compiler remains frozen.
Benchmark 001 remains the only application under study.

## Hypothesis

> A persistent machine-readable AIR contract may help AI preserve requirements, capabilities, invariants, and intent more reliably during repeated software changes than a strong conventional Rust, OpenAPI, JSON Schema, test, dependency-policy, and Wasmtime-policy workflow.

The experiment measures accumulated maintenance drift across one fixed 20-version evolution sequence.
It does not test whether AIR improves initial code generation.

## Pipelines

The conventional pipeline maintains Rust/Wasm source, OpenAPI, JSON Schema, visible integration cases, Cargo policy, Wasmtime capability policy, and ordinary requirements documentation.

The AIR pipeline maintains the same Rust/Wasm implementation plus one canonical AIR JSON contract.
The contract generates OpenAPI, visible integration cases, a capability policy, and verification metadata.
AIR remains data and verification metadata, not executable application code.

Both pipelines use the same hand-authored version-1 Rust/Wasm control, shared host, database implementation, model, reasoning setting, tools, sandbox, time limit, repair limit, change sequence, and independent oracle.

## Predeclared sample

The initial experiment contains five independent chains per pipeline.
Each chain starts from the same version-1 control and receives versions 2 through 20 sequentially.
Every version starts a fresh model context.
Repair turns resume only the context for the failing version.
No result from one chain is shown to another chain.

The sample is exploratory rather than confirmatory.
All paired raw results and failures must be reported.
The runner is designed to scale to ten or more chains without changing the protocol.

## Primary outcome

Retained Intent Rate is the number of currently active requirement groups satisfied by the independent oracle divided by the number of currently active requirement groups with oracle checks.

Final Retained Intent Rate is measured after version 20.
Retained-intent area under the curve is the arithmetic mean of the 20 per-version rates, which is equivalent to a normalized discrete area for equally spaced versions.

## Drift events

A historical regression occurs when an active requirement that passed in an earlier version fails after a later change that did not introduce or replace that requirement.
An obsolete-behavior event occurs when behavior explicitly removed or superseded remains possible.
A capability-creep event occurs when the Wasm module or project policy contains authority not required by the current oracle.
A capability-revocation failure occurs when an import or grant remains after its requirement has been revoked.
Schema, test, policy, invariant, and cross-artifact drift follow the definitions in [drift-taxonomy.md](../experiments/longitudinal-drift/drift-taxonomy.md).

## Predeclared materiality thresholds

AIR has a material retained-intent advantage if its paired mean normalized area under the curve is at least 0.05 higher, or its paired mean final retained-intent rate is at least 0.05 higher.

AIR has a material historical-regression advantage if it has at least 30 percent fewer historical regression events and at least two fewer events per chain on average.

AIR has a material capability-drift advantage if it has at least 50 percent fewer capability-creep and capability-revocation events combined and at least one fewer event per chain on average.

AIR has a material obsolete-behavior advantage if it has at least 40 percent fewer obsolete-behavior events and at least one fewer event per chain on average.

AIR has a material artifact-consistency advantage if its paired mean consistency rate is at least 0.05 higher and it does not require more manually maintained authoritative artifacts at version 20.

AIR has a material lifecycle-repair advantage if it uses at least 25 percent fewer repair turns attributable to historical requirements and at least two fewer such turns per chain on average.

AIR has a material lifecycle-generation-efficiency advantage if it uses at least 15 percent fewer total reported tokens per completed chain while its retained-intent area and final rate are no more than 0.02 worse.
This 15 percent lifecycle threshold is new and was selected before execution because repeated maintenance can compound small per-change differences.
It does not reinterpret the earlier 20 percent one-shot threshold.

Representation and deployment simplicity favour a pipeline descriptively if its final maintained representation or Wasm artifact is at least 20 percent smaller without greater dependency depth, more direct dependencies, or more manually maintained authoritative artifacts.
This descriptive outcome cannot independently make AIR promising.

Representation or Wasm size alone cannot make AIR promising.

## Decision rule

The result is PROMISING only if AIR meets at least one material longitudinal threshold for retained intent, historical regressions, capability drift, obsolete behavior, artifact consistency, lifecycle repair, or lifecycle generation efficiency.
AIR must also avoid a serious regression, defined as retained-intent area or final rate more than 0.05 worse, at least 25 percent more total repair turns, any successful undeclared runtime capability, or an incomplete AIR-to-policy propagation that the conventional baseline avoids.

The result is NOT PROMISING when all longitudinal differences remain inside their materiality bands, or when ordinary canonical schemas and policies match AIR while AIR adds equal or greater maintenance effort.

The result is INCONCLUSIVE when fewer than five paired chains complete, confidence is dominated by chain variance, or material wins and serious regressions conflict.

Recommendations map as follows:

- PROMISING maps to CONTINUE.
- INCONCLUSIVE maps to CHANGE DIRECTION.
- NOT PROMISING maps to STOP.

## Scientific controls

The complete sequence and thresholds are committed before the first experimental model call.
Neither pipeline can read future change prompts or the independent oracle from its isolated workspace.
The oracle tests every active requirement at every version and separately tests removed behavior.
The model may update project-owned tests, but those tests never define success.
No human code fixes are permitted.
The same maximum of two repair turns applies to every version and pipeline.
If a version remains broken, that broken state continues into the next version.

The protocol must not be tuned after early results.
A material harness defect requires aborting the experiment and preregistering a new protocol rather than silently repairing the active run.

## Prior results remain unchanged

The implementation-language experiment remains INCONCLUSIVE.
The specification-layer mutation experiment remains NOT PROMISING with a STOP recommendation.
This experiment asks a different question about accumulated specification drift during long-lived AI maintenance.
