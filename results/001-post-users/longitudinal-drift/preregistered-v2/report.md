# AIR longitudinal drift experiment report

## Result

**INCONCLUSIVE - CHANGE DIRECTION**

Only 0 of 5 preregistered paired chains completed validly.

## Required outcome matrix

Retained intent: **INCONCLUSIVE**

Historical regression resistance: **INCONCLUSIVE**

Capability drift resistance: **INCONCLUSIVE**

Obsolete behavior removal: **INCONCLUSIVE**

Artifact consistency: **INCONCLUSIVE**

Repairability over lifecycle: **INCONCLUSIVE**

Lifecycle generation efficiency: **INCONCLUSIVE**

Representation/deployment simplicity: **INCONCLUSIVE**

## Aggregate comparison

| Metric | Conventional baseline mean | AIR-contract mean |
| --- | ---: | ---: |
| Retained intent AUC | unavailable | unavailable |
| Final retained intent | unavailable | unavailable |
| Historical regressions per chain | unavailable | unavailable |
| Capability drift events per chain | unavailable | unavailable |
| Obsolete behavior events per chain | unavailable | unavailable |
| Artifact consistency | unavailable | unavailable |
| Repair turns per chain | unavailable | unavailable |
| Historical repair turns per chain | unavailable | unavailable |
| Lifecycle tokens per chain | unavailable | unavailable |

## Sample and failures

The report includes 0 valid complete conventional chains and 0 valid complete AIR-contract chains.
All invalidated, incomplete, and unsuccessful versions remain in the raw chain results and snapshots.
No failed chain is removed from the public result set.

## Interpretation

The conclusion is calculated from the thresholds preregistered in `docs/drift-hypothesis.md`.
Representation size and Wasm size are descriptive and cannot independently make AIR promising.
This longitudinal result does not alter the previous implementation-language or mutation-experiment conclusions.

## Falsification questions

1. Long-term requirement retention: INCONCLUSIVE.
2. Capability drift: INCONCLUSIVE.
3. Stale or obsolete behavior: INCONCLUSIVE.
4. Contract, code, test, schema, and policy consistency: INCONCLUSIVE.
5. Total AI maintenance effort: INCONCLUSIVE for tokens and INCONCLUSIVE for repairs.
6. Lifecycle token effect: unavailable.
7. Evolved representation and deployment surface: INCONCLUSIVE.
8. Existing formats as a canonical source: this benchmark found no drift advantage that requires AIR rather than a conventional canonical format.
9. New abstraction or consolidation: the experiment provides no evidence beyond consolidation of existing specifications.
10. Added tooling justified: CHANGE DIRECTION.

## Limitations and confounds

The five-chain sample is exploratory, has no exposed sampling seed, and supports no formal significance claim.
A hidden superset SQLite schema removes migration work equally from both pipelines.
The AIR treatment tests canonical-contract consolidation, so any advantage may be reproducible with an existing canonical format and generators.
Requirement-group weighting, correlated failures after a broken version, aggregate Codex token telemetry, and one small application limit generalisation.
The complete preregistered analysis is in `experiments/longitudinal-drift/confounds.md`.

## Reproduction evidence

`summary.json` contains per-chain values, paired observations, means, medians, materiality decisions, invalidations, and failure identities.
The `chains/` directory contains every version and repair attempt.
The `snapshots/` directory contains the complete public project state after every evaluated attempt.
