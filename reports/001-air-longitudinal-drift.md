# AIR longitudinal drift experiment

## Outcome

**Overall: INCONCLUSIVE**

**Recommendation: CHANGE DIRECTION**

Revision 2 completed all 5 baseline chains and all 5 AIR-contract chains through version 20, but no paired chain remained valid under the preregistered integrity rules.
The experiment therefore provides no valid comparative evidence that AIR improves longitudinal intent retention over a strong conventional Rust/Wasm workflow.

## Required outcome matrix

| Dimension | Outcome |
| --- | --- |
| Retained intent | INCONCLUSIVE |
| Historical regression resistance | INCONCLUSIVE |
| Capability drift resistance | INCONCLUSIVE |
| Obsolete behavior removal | INCONCLUSIVE |
| Artifact consistency | INCONCLUSIVE |
| Repairability over lifecycle | INCONCLUSIVE |
| Lifecycle generation efficiency | INCONCLUSIVE |
| Representation/deployment simplicity | INCONCLUSIVE |

## Why no comparison is valid

The protocol treated attempts to modify immutable experiment inputs, inspect parent or external paths, or use the network as chain-invalidating integrity failures.
Those rules were defined before revision-2 generation and applied equally to both pipelines.

| Pipeline | Chain | Recorded integrity failures |
| --- | ---: | --- |
| AIR contract | 1 | Modified immutable `HOST-CAPABILITIES.md` at v16. |
| AIR contract | 2 | Attempted parent-directory access at v5 and modified immutable `HOST-CAPABILITIES.md` at v16. |
| AIR contract | 3 | Attempted parent-directory access at v4 and modified immutable `HOST-CAPABILITIES.md` at v16. |
| AIR contract | 4 | Modified immutable `HOST-CAPABILITIES.md` at v16. |
| AIR contract | 5 | Modified immutable `HOST-CAPABILITIES.md` at v15 and v16 and attempted network commands at v16. |
| Conventional baseline | 1 | Modified immutable `HOST-CAPABILITIES.md` at v9, v12, and v16, attempted a network command at v16, and attempted parent-directory access at v18. |
| Conventional baseline | 2 | Modified immutable `HOST-CAPABILITIES.md` at v12, v16, and v20 and attempted a network command at v16. |
| Conventional baseline | 3 | Attempted parent-directory access at v8 and v18 and modified immutable `HOST-CAPABILITIES.md` at v16. |
| Conventional baseline | 4 | Attempted parent-directory access at v8, v10, and v18, modified immutable `HOST-CAPABILITIES.md` at v9, v12, v15, and v16, and attempted a network command at v16. |
| Conventional baseline | 5 | Attempted access outside the isolated workspace at v9 and modified immutable `HOST-CAPABILITIES.md` at v14, v15, v16, and v20. |

Repeated detections within one version are retained in the machine-readable chain records even when the table above collapses them for readability.
All 200 version evaluations, every repair attempt, all failed versions, and the frozen snapshots remain in the raw result set.

## Interpretation

The late-version retained-intent scores and lifecycle measurements are diagnostic only because every contributing chain was invalidated.
They must not be used to declare AIR, the baseline, or a tie as the winner.
The preregistered decision rule requires five valid paired chains, so all comparison aggregates are unavailable rather than estimated from invalid samples.

The invalidations occurred in both treatments and expose a confound in the maintenance harness.
The model could see immutable host documentation inside the editable project workspace, and the command-audit policy invalidated an entire accumulated chain after any prohibited attempt.
Changing that boundary or weakening invalidation after observing the run would create a third protocol and would not rescue revision 2.

Protocol revision 1 had already been aborted because exact current requirement identifiers were required by the artifact checks but were not supplied to either pipeline.
Revision 2 corrected only that neutral input defect and was publicly preregistered before its model calls.
Neither revision supplies comparative evidence.

## Falsification questions

1. Long-term requirement retention is INCONCLUSIVE.
2. Capability-drift resistance is INCONCLUSIVE.
3. Removal of stale or obsolete behavior is INCONCLUSIVE.
4. Consistency between implementation, tests, schema, and policy is INCONCLUSIVE.
5. Total AI maintenance effort is INCONCLUSIVE.
6. The lifecycle token effect is unavailable.
7. Evolved representation and deployment simplicity are INCONCLUSIVE.
8. This experiment found no valid evidence that AIR beats existing canonical formats and generators.
9. This experiment found no valid evidence that AIR is more than a consolidation of existing specifications.
10. The added AIR tooling is not justified by this experiment.

## Scientific conclusion

This result does not alter any previous AIR result.
It also does not establish that the two approaches are equivalent.
It establishes that the one additional longitudinal experiment failed to produce a valid comparative sample.

The evidence-based recommendation is **CHANGE DIRECTION**.
Do not resume AIR language work, add executable AIR features, or claim a longitudinal advantage from these invalid chains.

## Evidence

- The preregistered hypothesis and thresholds are in [`docs/drift-hypothesis.md`](../docs/drift-hypothesis.md).
- The fixed sequence and protocol are in [`experiments/longitudinal-drift/`](../experiments/longitudinal-drift/).
- The machine-readable summary is in [`results/001-post-users/longitudinal-drift/preregistered-v2/summary.json`](../results/001-post-users/longitudinal-drift/preregistered-v2/summary.json).
- The generated report is in [`results/001-post-users/longitudinal-drift/preregistered-v2/report.md`](../results/001-post-users/longitudinal-drift/preregistered-v2/report.md).
- Complete chain records and snapshots are in [`results/001-post-users/longitudinal-drift/preregistered-v2/`](../results/001-post-users/longitudinal-drift/preregistered-v2/).
