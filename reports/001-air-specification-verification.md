# AIR Specification/Verification Experiment - Benchmark 001

## Final decision

Capability configuration: **AIR ADVANTAGE**
Contract-derived verification: **BASELINE EQUIVALENT**
Seeded defect detection: **BASELINE EQUIVALENT**
Manual verification complexity: **BASELINE**
Spec-to-implementation drift resistance: **AIR**

Overall: **NOT PROMISING**

Recommendation: **STOP**

Does AIR provide meaningful verification lift over ordinary AI-generated Rust/Wasm tooling? **NO**.

Reason: AIR detected 14/14 seeded defects while the existing baseline detected 8/14, but a small ordinary-tooling augmentation also detected 14/14.
The AIR runtime manifest and manually authored Wasmtime manifest produced the same effective enforcement.
AIR centralised the facts and reduced drift risk, but the measured detection lift came from five additional email cases and one Cargo dependency limit that ordinary tests and Cargo metadata reproduced without an AIR-specific contract compiler.

## Experiment result

All 14 faulty Rust candidates compiled successfully to Wasm.
The correct control passed every pipeline, so this sample observed no false positive.

| Metric | Existing Rust/Wasm baseline | AIR contract layer | Ordinary augmented baseline |
|---|---:|---:|---:|
| Seeded defects detected | 8/14 | 14/14 | 14/14 |
| False negatives | 6 | 0 | 0 |
| False positives | 0 | 0 | 0 |
| Additional detections over existing baseline | 0 | 6 | 6 |

The raw AIR verification lift over the existing baseline was 6 defects.
Those defects were `accept-domain-without-dot`, `accept-multiple-at`, `accept-ascii-whitespace`, `accept-leading-domain-dot`, `accept-trailing-domain-dot`, `undeclared-local-dependency`.
The augmented ordinary baseline erased that lift with five explicit integration cases and a Cargo metadata dependency policy.

## Detection matrix

| Fault | Existing baseline | AIR verification | Ordinary augmented |
|---|---|---|---|
| accept-domain-without-dot | missed | contract_derived_dynamic_checks | additional_integration_tests |
| accept-multiple-at | missed | contract_derived_dynamic_checks | additional_integration_tests |
| accept-ascii-whitespace | missed | contract_derived_dynamic_checks | additional_integration_tests |
| accept-leading-domain-dot | missed | contract_derived_dynamic_checks | additional_integration_tests |
| accept-trailing-domain-dot | missed | contract_derived_dynamic_checks | additional_integration_tests |
| accept-empty-name | existing_functional_tests | contract_derived_dynamic_checks | existing_baseline |
| allow-duplicate-email | existing_functional_tests | contract_derived_dynamic_checks | existing_baseline |
| fake-id-without-insert | existing_functional_tests | contract_derived_dynamic_checks | existing_baseline |
| wrong-returned-id | existing_functional_tests | contract_derived_dynamic_checks | existing_baseline |
| mask-storage-failure | existing_functional_tests | contract_derived_dynamic_checks | existing_baseline |
| environment-import | wasmtime_host_policy | generated_capability_manifest | existing_baseline, manual_capability_manifest |
| outbound-http-import | wasmtime_host_policy | generated_capability_manifest | existing_baseline, manual_capability_manifest |
| other-table-import | wasmtime_host_policy | generated_capability_manifest | existing_baseline, manual_capability_manifest |
| undeclared-local-dependency | missed | contract_dependency_policy | cargo_metadata_policy |

No failure is omitted from the matrix.

## What AIR derived

The contract generated one runtime manifest with the same effective allowlist and resource limits as the manual baseline policy.
The contract also generated 2 static rule classes and 11 dynamic rule classes.
The dynamic verifier expanded named predicates into concrete cases and checked response shape, returned IDs, SQLite row state, uniqueness, and unavailable-storage behavior.

The capability configuration result is an AIR advantage because one contract produced the import allowlist and resource policy automatically.
The enforcement result is baseline equivalent because Wasmtime and the same host implementation stopped the unauthorized imports in both pipelines.

## Static and dynamic guarantees

Static AIR checks detected 4 seeded defects.
They checked the Wasm import allowlist and Cargo dependency limits before candidate execution.
Contract structure and supported rule vocabulary were also validated before any artifact was accepted.

Dynamic AIR checks detected 10 seeded defects.
They executed generated HTTP cases and inspected SQLite state.
These checks are contract-derived tests, not formal proofs.
They do not prove behavior outside their generated cases.

Runtime isolation remained a property of Wasmtime plus the narrow host implementation.
AIR selected the policy but did not create a stronger sandbox.

## False-positive and false-negative analysis

AIR observed zero false negatives across the 14 seeded faults and zero false positives across one correct control.
The ordinary augmented comparator observed the same result.
One correct control is not enough to estimate a useful false-positive rate, and deliberately seeded faults are not a representative population of future AI mistakes.
The result establishes mutation coverage for this suite only.

Five of AIR's six additional detections came from counterexamples stored in the reusable `air_email_v1` predicate implementation rather than from reasoning or proof.
An ordinary integration test stored the same five examples and produced the same detection.
The sixth came from a zero-dependency threshold checked through Cargo metadata.

## Complexity comparison

Generated manifest and verification-plan files are excluded from authoritative-source counts because they are reproducible outputs.
Byte counts are secondary evidence and are not treated as a quality metric by themselves.
The shared-host manifest support added for this experiment is excluded from both custom-tool byte totals, which is conservative in AIR's favor.

| Measure | AIR approach | Ordinary augmented approach |
|---|---:|---:|
| Application-specific authoritative files | 3 | 6 |
| Application-specific authoritative bytes | 20431 | 23487 |
| New comparator files beyond existing tests | 1 contract | 4 files |
| Custom AIR schema/tool files | 4 | 0 AIR-specific files |
| Custom AIR schema/tool bytes | 30935 | 0 |
| Candidate dependencies | 0 required | 0 required |
| Runtime capability enforcement | Shared Wasmtime host | Shared Wasmtime host |

AIR has the better per-application source-of-truth shape because behavior, effects, capabilities, dependencies, and resources occur in one contract.
The ordinary stack has the lower new-platform cost because it uses OpenAPI and JSON Schema concepts, Cargo metadata, explicit host policy, and integration tests.
For Benchmark 001, adding the five missing test cases and one dependency policy is simpler than maintaining the AIR-specific schema, validator, generator, and dynamic runner.
Manual verification complexity therefore favors the baseline in this milestone.

## Drift resistance

AIR generated the runtime manifest and verification plan from one hashed contract, so those outputs cannot silently disagree with the contract when regenerated.
The ordinary comparator splits the same facts across OpenAPI, a runtime policy, a dependency policy, and tests.
AIR therefore has a real drift-resistance advantage at the configuration layer.

That advantage does not prove the Rust implementation conforms.
Conformance still depends on running static checks and finite dynamic tests, just as it does in the ordinary stack.

## Opposite hypothesis

OpenAPI 3.1 can carry JSON Schema vocabulary for request and response shapes.
Cargo metadata can expose the resolved dependency graph.
Wasmtime host configuration can enforce an import allowlist and resource limits.
Ordinary integration tests can check database effects and business invariants.

The augmented comparator combined those mechanisms and matched AIR's 14/14 defect detection with zero observed false positives.
This is direct evidence that AIR's verification result can be reproduced without introducing AIR.

## Limitations

- The email predicate and generated counterexamples are specialised to Benchmark 001.
- The runtime host still implements exactly one benchmark-specific SQLite operation.
- The mutation set is deliberate and known to both evaluation designs.
- The correct-control sample contains only one implementation.
- OpenAPI and JSON Schema do not themselves enforce runtime behavior without supporting tools.
- Dynamic postcondition and invariant checks remain finite tests.
- No AI-generation trial of AIR contracts was performed in this milestone.
- Benchmark 002 was not created.
- The frozen executable AIR compiler was not extended.

## Evidence

The machine-readable summary is `results/001-post-users/verification-experiment/summary.json`.
The complete detection matrix is `results/001-post-users/verification-experiment/detection-matrix.json`.
Every generated faulty candidate and every raw compiler, host, functional-test, dependency, and derived-check result is retained under `results/001-post-users/verification-experiment/`.

The ordinary comparator uses the official [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html), [JSON Schema 2020-12 validation vocabulary](https://json-schema.org/draft/2020-12/json-schema-validation), and [Cargo metadata interface](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html) as its standard foundations.
