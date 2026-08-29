import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDirectory, "../..");
const resultRoot = path.join(root, "results/001-post-users/verification-experiment");
const summary = readJson(path.join(resultRoot, "summary.json"));
const matrix = readJson(path.join(resultRoot, "detection-matrix.json"));

const files = {
  contract: "benchmarks/001-post-users/verification/air.contract.json",
  contractSchema: "verification/air-contract.schema.json",
  contractLibrary: "verification/contract.mjs",
  contractCli: "verification/air-contract.mjs",
  derivedRunner: "verification/run-derived.mjs",
  openapi: "benchmarks/001-post-users/verification/baseline/openapi.json",
  manualManifest: "benchmarks/001-post-users/verification/baseline/runtime-capability-manifest.json",
  dependencyPolicy: "benchmarks/001-post-users/verification/baseline/dependency-policy.json",
  existingFunctional: "benchmark-runner/functional.mjs",
  existingSecurity: "benchmark-runner/security.mjs",
  additionalTests: "benchmark-runner/verification-experiment/ordinary-additional.mjs",
};

const airApplicationSources = [files.contract, files.existingFunctional, files.existingSecurity];
const airToolSources = [files.contractSchema, files.contractLibrary, files.contractCli, files.derivedRunner];
const ordinaryApplicationSources = [
  files.openapi,
  files.manualManifest,
  files.dependencyPolicy,
  files.existingFunctional,
  files.existingSecurity,
  files.additionalTests,
];
const ordinaryIncrementalSources = [
  files.openapi,
  files.manualManifest,
  files.dependencyPolicy,
  files.additionalTests,
];

const report = `# AIR Specification/Verification Experiment - Benchmark 001

## Final decision

Capability configuration: **AIR ADVANTAGE**
Contract-derived verification: **BASELINE EQUIVALENT**
Seeded defect detection: **BASELINE EQUIVALENT**
Manual verification complexity: **BASELINE**
Spec-to-implementation drift resistance: **AIR**

Overall: **NOT PROMISING**

Recommendation: **STOP**

Does AIR provide meaningful verification lift over ordinary AI-generated Rust/Wasm tooling? **NO**.

Reason: AIR detected ${summary.air.defects_detected}/${summary.seeded_defects} seeded defects while the existing baseline detected ${summary.baseline.defects_detected}/${summary.seeded_defects}, but a small ordinary-tooling augmentation also detected ${summary.ordinary_augmented.defects_detected}/${summary.seeded_defects}.
The AIR runtime manifest and manually authored Wasmtime manifest produced the same effective enforcement.
AIR centralised the facts and reduced drift risk, but the measured detection lift came from five additional email cases and one Cargo dependency limit that ordinary tests and Cargo metadata reproduced without an AIR-specific contract compiler.

## Experiment result

All ${summary.compilation.compiling_faults} faulty Rust candidates compiled successfully to Wasm.
The correct control passed every pipeline, so this sample observed no false positive.

| Metric | Existing Rust/Wasm baseline | AIR contract layer | Ordinary augmented baseline |
|---|---:|---:|---:|
| Seeded defects detected | ${summary.baseline.defects_detected}/${summary.seeded_defects} | ${summary.air.defects_detected}/${summary.seeded_defects} | ${summary.ordinary_augmented.defects_detected}/${summary.seeded_defects} |
| False negatives | ${summary.baseline.false_negatives} | ${summary.air.false_negatives} | ${summary.ordinary_augmented.false_negatives} |
| False positives | ${summary.baseline.false_positives} | ${summary.air.false_positives} | ${summary.ordinary_augmented.false_positives} |
| Additional detections over existing baseline | 0 | ${summary.verification_lift.additional_defects_detected} | ${summary.ordinary_augmented.defects_detected - summary.baseline.defects_detected} |

The raw AIR verification lift over the existing baseline was ${summary.verification_lift.additional_defects_detected} defects.
Those defects were ${summary.verification_lift.defect_ids.map((id) => `\`${id}\``).join(", ")}.
The augmented ordinary baseline erased that lift with five explicit integration cases and a Cargo metadata dependency policy.

## Detection matrix

| Fault | Existing baseline | AIR verification | Ordinary augmented |
|---|---|---|---|
${matrix.map(matrixRow).join("\n")}

No failure is omitted from the matrix.

## What AIR derived

The contract generated one runtime manifest with ${summary.runtime_manifest.enforcement_equivalent ? "the same" : "different"} effective allowlist and resource limits as the manual baseline policy.
The contract also generated ${summary.derived_checks.static_rules} static rule classes and ${summary.derived_checks.dynamic_rules} dynamic rule classes.
The dynamic verifier expanded named predicates into concrete cases and checked response shape, returned IDs, SQLite row state, uniqueness, and unavailable-storage behavior.

The capability configuration result is an AIR advantage because one contract produced the import allowlist and resource policy automatically.
The enforcement result is baseline equivalent because Wasmtime and the same host implementation stopped the unauthorized imports in both pipelines.

## Static and dynamic guarantees

Static AIR checks detected ${summary.air.static_detections} seeded defects.
They checked the Wasm import allowlist and Cargo dependency limits before candidate execution.
Contract structure and supported rule vocabulary were also validated before any artifact was accepted.

Dynamic AIR checks detected ${summary.air.dynamic_detections} seeded defects.
They executed generated HTTP cases and inspected SQLite state.
These checks are contract-derived tests, not formal proofs.
They do not prove behavior outside their generated cases.

Runtime isolation remained a property of Wasmtime plus the narrow host implementation.
AIR selected the policy but did not create a stronger sandbox.

## False-positive and false-negative analysis

AIR observed zero false negatives across the ${summary.seeded_defects} seeded faults and zero false positives across one correct control.
The ordinary augmented comparator observed the same result.
One correct control is not enough to estimate a useful false-positive rate, and deliberately seeded faults are not a representative population of future AI mistakes.
The result establishes mutation coverage for this suite only.

Five of AIR's six additional detections came from counterexamples stored in the reusable \`air_email_v1\` predicate implementation rather than from reasoning or proof.
An ordinary integration test stored the same five examples and produced the same detection.
The sixth came from a zero-dependency threshold checked through Cargo metadata.

## Complexity comparison

Generated manifest and verification-plan files are excluded from authoritative-source counts because they are reproducible outputs.
Byte counts are secondary evidence and are not treated as a quality metric by themselves.
The shared-host manifest support added for this experiment is excluded from both custom-tool byte totals, which is conservative in AIR's favor.

| Measure | AIR approach | Ordinary augmented approach |
|---|---:|---:|
| Application-specific authoritative files | ${airApplicationSources.length} | ${ordinaryApplicationSources.length} |
| Application-specific authoritative bytes | ${bytes(airApplicationSources)} | ${bytes(ordinaryApplicationSources)} |
| New comparator files beyond existing tests | 1 contract | ${ordinaryIncrementalSources.length} files |
| Custom AIR schema/tool files | ${airToolSources.length} | 0 AIR-specific files |
| Custom AIR schema/tool bytes | ${bytes(airToolSources)} | 0 |
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

The augmented comparator combined those mechanisms and matched AIR's ${summary.air.defects_detected}/${summary.seeded_defects} defect detection with zero observed false positives.
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

The machine-readable summary is \`results/001-post-users/verification-experiment/summary.json\`.
The complete detection matrix is \`results/001-post-users/verification-experiment/detection-matrix.json\`.
Every generated faulty candidate and every raw compiler, host, functional-test, dependency, and derived-check result is retained under \`results/001-post-users/verification-experiment/\`.

The ordinary comparator uses the official [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.1.html), [JSON Schema 2020-12 validation vocabulary](https://json-schema.org/draft/2020-12/json-schema-validation), and [Cargo metadata interface](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html) as its standard foundations.
`;

const reportFile = path.join(root, "reports/001-air-specification-verification.md");
fs.writeFileSync(reportFile, report);
process.stdout.write(`${reportFile}\n`);

function matrixRow(row) {
  return `| ${row.id} | ${stage(row.existing_baseline)} | ${stage(row.air_verification)} | ${stage(row.ordinary_augmented)} |`;
}

function stage(value) {
  return value.detected ? value.stages.join(", ") || "detected" : "missed";
}

function bytes(paths) {
  return paths.reduce((total, file) => total + fs.statSync(path.join(root, file)).size, 0);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
