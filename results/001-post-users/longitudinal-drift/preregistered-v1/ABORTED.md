# Protocol revision 1 aborted

Protocol revision 1 was stopped during the first paired version-2 change.
Both pipelines satisfied all five active runtime requirement groups but could not satisfy project-registry consistency.

The evaluator required the exact identifier `LD-002-name-length-1-100` in each project registry.
The model input supplied the neutral requirement wording but did not disclose that required bookkeeping identifier.
The repair diagnostics also reported only the inconsistent artifact names rather than the missing expected identifier.
Full success was therefore not reasonably attainable from the provided inputs.

This is classified as a material input-completeness defect in the harness.
The experiment was interrupted before version 3, and its partial outputs are preserved without interpretation.
They are not included in the longitudinal comparison.

Protocol revision 2 changes only the current-change document so both pipelines receive the identifiers activated or retired by that change.
The requirement sequence, wording, oracle, thresholds, model, runtime, repair budget, and decision rules remain unchanged.
