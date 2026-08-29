import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  deriveCapabilityManifest,
  deriveChecks,
  readContract,
} from "../../verification/contract.mjs";
import { candidateManifest, mutations } from "./mutations.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDirectory, "../..");
const contractFile = path.join(root, "benchmarks/001-post-users/verification/air.contract.json");
const baseSourceFile = path.join(root, "benchmarks/001-post-users/rust/src/lib.rs");
const host = path.join(root, "benchmark-runner/target/release/air-benchmark-host");
const resultRoot = path.join(root, "results/001-post-users/verification-experiment");
const generatedDirectory = path.join(resultRoot, "generated");
const candidatesDirectory = path.join(resultRoot, "candidates");
const rawDirectory = path.join(resultRoot, "raw");

fs.rmSync(resultRoot, { recursive: true, force: true });
fs.mkdirSync(generatedDirectory, { recursive: true });
fs.mkdirSync(candidatesDirectory, { recursive: true });
fs.mkdirSync(rawDirectory, { recursive: true });

requireSuccess("shared host build", "cargo", [
  "build",
  "--release",
  "--locked",
  "--manifest-path",
  "benchmark-runner/Cargo.toml",
]);
requireSuccess("AIR compiler build for the frozen security baseline", "cargo", [
  "build",
  "--locked",
  "--bin",
  "air",
]);

const contractBytes = fs.readFileSync(contractFile);
const contract = readContract(contractFile);
const capabilityManifest = deriveCapabilityManifest(contract, contractBytes);
const derivedPlan = deriveChecks(contract);
const capabilityManifestFile = path.join(generatedDirectory, "runtime-capability-manifest.json");
const derivedPlanFile = path.join(generatedDirectory, "derived-verification-plan.json");
writeJson(capabilityManifestFile, capabilityManifest);
writeJson(derivedPlanFile, derivedPlan);

const manualManifestFile = path.join(
  root,
  "benchmarks/001-post-users/verification/baseline/runtime-capability-manifest.json",
);
const manualDependencyPolicyFile = path.join(
  root,
  "benchmarks/001-post-users/verification/baseline/dependency-policy.json",
);
const manualDependencyPolicy = JSON.parse(fs.readFileSync(manualDependencyPolicyFile, "utf8"));
const manifestEquivalence = compareRuntimeManifests(
  capabilityManifest,
  JSON.parse(fs.readFileSync(manualManifestFile, "utf8")),
);

const baseSource = fs.readFileSync(baseSourceFile, "utf8");
const candidates = [
  {
    id: "correct-control",
    defect: null,
    category: "control",
    expected_baseline_detection: false,
    ordinary_equivalent: null,
    mutateSource: (source) => source,
  },
  ...mutations,
];
const observations = [];

for (const candidate of candidates) {
  process.stdout.write(`${JSON.stringify({ event: "candidate_started", id: candidate.id })}\n`);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `air-verification-${candidate.id}-`));
  try {
    const source = candidate.mutateSource(baseSource);
    const manifest = candidate.mutateManifest
      ? candidate.mutateManifest(candidateManifest)
      : candidateManifest;
    writeText(path.join(workspace, "src/lib.rs"), source);
    writeText(path.join(workspace, "Cargo.toml"), manifest);
    for (const [file, value] of Object.entries(candidate.extraFiles ?? {})) {
      writeText(path.join(workspace, file), value);
    }

    const snapshot = path.join(candidatesDirectory, candidate.id);
    fs.cpSync(workspace, snapshot, { recursive: true });
    const candidateRaw = path.join(rawDirectory, candidate.id);
    fs.mkdirSync(candidateRaw, { recursive: true });

    const lock = run("cargo", [
      "generate-lockfile",
      "--offline",
      "--manifest-path",
      path.join(workspace, "Cargo.toml"),
    ], { cwd: workspace });
    writeText(path.join(candidateRaw, "lock.stdout.txt"), lock.stdout);
    writeText(path.join(candidateRaw, "lock.stderr.txt"), lock.stderr);

    const targetDirectory = path.join(workspace, "target");
    const build = run("cargo", [
      "build",
      "--release",
      "--offline",
      "--target",
      "wasm32-wasip1",
      "--manifest-path",
      path.join(workspace, "Cargo.toml"),
    ], { cwd: workspace, environment: { ...process.env, CARGO_TARGET_DIR: targetDirectory } });
    writeText(path.join(candidateRaw, "build.stdout.txt"), build.stdout);
    writeText(path.join(candidateRaw, "build.stderr.txt"), build.stderr);
    const wasm = path.join(targetDirectory, "wasm32-wasip1/release/mutation_candidate.wasm");
    const compileSuccess = lock.status === 0 && build.status === 0 && fs.existsSync(wasm);

    const dependencyMetrics = lock.status === 0
      ? cargoDependencyMetrics(path.join(workspace, "Cargo.toml"), workspace)
      : null;
    const dependencyCheck = dependencyMetrics
      ? evaluateDependencyLimits(dependencyMetrics, contract.dependencies)
      : { passed: false, diagnostics: ["Cargo metadata unavailable."] };

    const baselineInspect = compileSuccess
      ? run(host, ["inspect", "--wasm", wasm])
      : notRun("candidate did not compile");
    writeCommandResult(path.join(candidateRaw, "baseline-inspect.json"), baselineInspect);
    const baselineFunctionalFile = path.join(candidateRaw, "baseline-functional.json");
    const baselineFunctional = compileSuccess && baselineInspect.status === 0
      ? run(
          "node",
          [
            "--disable-warning=ExperimentalWarning",
            "benchmark-runner/functional.mjs",
            "--host",
            host,
            "--wasm",
            wasm,
            "--target",
            candidate.id,
            "--output",
            baselineFunctionalFile,
          ],
          { cwd: root, timeout: 120_000 },
        )
      : notRun("candidate was rejected before functional tests");
    writeCommandResult(path.join(candidateRaw, "baseline-functional-command.json"), baselineFunctional);
    const baselineFunctionalResult = fs.existsSync(baselineFunctionalFile)
      ? JSON.parse(fs.readFileSync(baselineFunctionalFile, "utf8"))
      : null;
    const baselineDetected =
      !compileSuccess ||
      baselineInspect.status !== 0 ||
      baselineFunctionalResult?.correctness.full_test_success === false;

    const ordinaryInspect = compileSuccess
      ? run(host, [
          "inspect",
          "--wasm",
          wasm,
          "--capability-manifest",
          manualManifestFile,
        ])
      : notRun("candidate did not compile");
    writeCommandResult(path.join(candidateRaw, "ordinary-static-inspect.json"), ordinaryInspect);
    const ordinaryDependencyCheck = dependencyMetrics
      ? evaluateDependencyLimits(dependencyMetrics, manualDependencyPolicy)
      : { passed: false, diagnostics: ["Cargo metadata unavailable."] };
    const ordinaryAdditionalFile = path.join(candidateRaw, "ordinary-additional-tests.json");
    const ordinaryAdditional =
      !baselineDetected && ordinaryInspect.status === 0 && ordinaryDependencyCheck.passed
        ? run(
            "node",
            [
              "--disable-warning=ExperimentalWarning",
              "benchmark-runner/verification-experiment/ordinary-additional.mjs",
              "--host",
              host,
              "--wasm",
              wasm,
              "--manifest",
              manualManifestFile,
              "--output",
              ordinaryAdditionalFile,
            ],
            { cwd: root, timeout: 60_000 },
          )
        : notRun("existing baseline or ordinary static policy already detected the candidate");
    writeCommandResult(path.join(candidateRaw, "ordinary-additional-command.json"), ordinaryAdditional);
    const ordinaryAdditionalResult = fs.existsSync(ordinaryAdditionalFile)
      ? JSON.parse(fs.readFileSync(ordinaryAdditionalFile, "utf8"))
      : null;
    const ordinaryDetected =
      baselineDetected ||
      ordinaryInspect.status !== 0 ||
      !ordinaryDependencyCheck.passed ||
      ordinaryAdditionalResult?.full_success === false;

    const airInspect = compileSuccess
      ? run(host, [
          "inspect",
          "--wasm",
          wasm,
          "--capability-manifest",
          capabilityManifestFile,
        ])
      : notRun("candidate did not compile");
    writeCommandResult(path.join(candidateRaw, "air-static-inspect.json"), airInspect);
    const staticPassed = compileSuccess && airInspect.status === 0 && dependencyCheck.passed;
    const dynamicFile = path.join(candidateRaw, "air-derived-dynamic.json");
    const dynamic = staticPassed
      ? run(
          "node",
          [
            "--disable-warning=ExperimentalWarning",
            "verification/run-derived.mjs",
            "--plan",
            derivedPlanFile,
            "--host",
            host,
            "--wasm",
            wasm,
            "--manifest",
            capabilityManifestFile,
            "--output",
            dynamicFile,
          ],
          { cwd: root, timeout: 120_000 },
        )
      : notRun("static AIR verification rejected the candidate");
    writeCommandResult(path.join(candidateRaw, "air-dynamic-command.json"), dynamic);
    const dynamicResult = fs.existsSync(dynamicFile)
      ? JSON.parse(fs.readFileSync(dynamicFile, "utf8"))
      : null;
    const airDetected = !staticPassed || dynamicResult?.full_success === false;

    const observation = {
      id: candidate.id,
      control: candidate.defect === null,
      defect: candidate.defect,
      category: candidate.category,
      ordinary_equivalent: candidate.ordinary_equivalent,
      expected_baseline_detection: candidate.expected_baseline_detection,
      compile: {
        success: compileSuccess,
        artifact_bytes: compileSuccess ? fs.statSync(wasm).size : null,
        artifact_sha256: compileSuccess ? sha256(wasm) : null,
      },
      baseline: {
        detected: baselineDetected,
        compiler_detected: !compileSuccess,
        runtime_policy_detected: compileSuccess && baselineInspect.status !== 0,
        functional_tests_detected:
          baselineFunctionalResult?.correctness.full_test_success === false,
        functional_tests_passed: baselineFunctionalResult?.correctness.tests_passed ?? null,
        functional_tests_total: baselineFunctionalResult?.correctness.tests_total ?? null,
      },
      air: {
        detected: airDetected,
        static_detected: !staticPassed,
        capability_manifest_detected: compileSuccess && airInspect.status !== 0,
        dependency_policy_detected: !dependencyCheck.passed,
        dynamic_detected: dynamicResult?.full_success === false,
        failed_dynamic_checks:
          dynamicResult?.checks.filter((check) => !check.passed).map((check) => check.id) ?? [],
      },
      ordinary_augmented: {
        detected: ordinaryDetected,
        existing_baseline_detected: baselineDetected,
        manual_capability_policy_detected: compileSuccess && ordinaryInspect.status !== 0,
        manual_dependency_policy_detected: !ordinaryDependencyCheck.passed,
        additional_integration_tests_detected:
          ordinaryAdditionalResult?.full_success === false,
      },
      dependency_metrics: dependencyMetrics,
      dependency_check: dependencyCheck,
      source: {
        bytes: Buffer.byteLength(source),
        sha256: hashText(source),
      },
      raw_directory: path.relative(root, candidateRaw),
      candidate_snapshot: path.relative(root, snapshot),
    };
    writeJson(path.join(candidateRaw, "observation.json"), observation);
    observations.push(observation);
    process.stdout.write(
      `${JSON.stringify({
        event: "candidate_completed",
        id: candidate.id,
        compile_success: compileSuccess,
        baseline_detected: baselineDetected,
        air_detected: airDetected,
        ordinary_augmented_detected: ordinaryDetected,
      })}\n`,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const control = observations.find((observation) => observation.control);
const faults = observations.filter((observation) => !observation.control);
const baselineDetected = faults.filter((observation) => observation.baseline.detected).length;
const airDetected = faults.filter((observation) => observation.air.detected).length;
const ordinaryDetected = faults.filter(
  (observation) => observation.ordinary_augmented.detected,
).length;
const lift = faults.filter(
  (observation) => observation.air.detected && !observation.baseline.detected,
);
const summary = {
  schema_version: 1,
  experiment: "air-specification-verification-benchmark-001",
  generated_at: new Date().toISOString(),
  source_contract: path.relative(root, contractFile),
  contract_sha256: sha256(contractFile),
  seeded_defects: faults.length,
  compilation: {
    compiling_faults: faults.filter((observation) => observation.compile.success).length,
    required_compiling_faults: faults.length,
  },
  baseline: {
    defects_detected: baselineDetected,
    defects_missed: faults.length - baselineDetected,
    false_positives: control.baseline.detected ? 1 : 0,
    false_negatives: faults.length - baselineDetected,
  },
  air: {
    defects_detected: airDetected,
    defects_missed: faults.length - airDetected,
    false_positives: control.air.detected ? 1 : 0,
    false_negatives: faults.length - airDetected,
    static_detections: faults.filter((observation) => observation.air.static_detected).length,
    dynamic_detections: faults.filter((observation) => observation.air.dynamic_detected).length,
  },
  ordinary_augmented: {
    defects_detected: ordinaryDetected,
    defects_missed: faults.length - ordinaryDetected,
    false_positives: control.ordinary_augmented.detected ? 1 : 0,
    false_negatives: faults.length - ordinaryDetected,
    components: [
      "OpenAPI and JSON Schema HTTP description",
      "existing integration and security tests",
      "manual Wasmtime capability manifest",
      "Cargo metadata dependency limits",
      "five additional hand-written email integration cases",
    ],
  },
  verification_lift: {
    additional_defects_detected: lift.length,
    defect_ids: lift.map((observation) => observation.id),
    definition: "Faults detected by AIR verification that passed compilation, the existing host policy, and the existing functional tests.",
  },
  runtime_manifest: {
    generated: path.relative(root, capabilityManifestFile),
    manually_authored_comparator: path.relative(root, manualManifestFile),
    enforcement_equivalent: manifestEquivalence.equivalent,
    differences: manifestEquivalence.differences,
  },
  derived_checks: {
    generated: path.relative(root, derivedPlanFile),
    static_rules: derivedPlan.checks.filter((check) => check.class === "static").length,
    dynamic_rules: derivedPlan.checks.filter((check) => check.class === "dynamic").length,
  },
  observations,
};
writeJson(path.join(resultRoot, "summary.json"), summary);
writeJson(
  path.join(resultRoot, "detection-matrix.json"),
  faults.map((observation) => ({
    id: observation.id,
    defect: observation.defect,
    category: observation.category,
    compiled: observation.compile.success,
    existing_baseline: {
      detected: observation.baseline.detected,
      stages: detectionStages(observation.baseline, {
        compiler_detected: "rust_compiler",
        runtime_policy_detected: "wasmtime_host_policy",
        functional_tests_detected: "existing_functional_tests",
      }),
    },
    air_verification: {
      detected: observation.air.detected,
      stages: detectionStages(observation.air, {
        capability_manifest_detected: "generated_capability_manifest",
        dependency_policy_detected: "contract_dependency_policy",
        dynamic_detected: "contract_derived_dynamic_checks",
      }),
      failed_dynamic_checks: observation.air.failed_dynamic_checks,
    },
    ordinary_augmented: {
      detected: observation.ordinary_augmented.detected,
      stages: detectionStages(observation.ordinary_augmented, {
        existing_baseline_detected: "existing_baseline",
        manual_capability_policy_detected: "manual_capability_manifest",
        manual_dependency_policy_detected: "cargo_metadata_policy",
        additional_integration_tests_detected: "additional_integration_tests",
      }),
    },
  })),
);

const securityOutput = path.join(resultRoot, "baseline-security-control.json");
const controlBuild = rebuildControlForSecurity();
const security = run(
  "node",
  [
    "benchmark-runner/security.mjs",
    "--host",
    host,
    "--wasm",
    controlBuild,
    "--target",
    "rust-wasm",
    "--air-source",
    "benchmarks/001-post-users/air/program.air",
    "--air-compiler",
    "target/debug/air",
    "--attacks",
    "benchmarks/001-post-users/attacks",
    "--output",
    securityOutput,
  ],
  { cwd: root },
);
writeCommandResult(path.join(resultRoot, "baseline-security-command.json"), security);
if (security.status !== 0) throw new Error(`baseline security suite failed: ${security.stderr}`);

writeJson(path.join(resultRoot, "manifest.json"), {
  schema_version: 1,
  benchmark: "001-post-users",
  contract: path.relative(root, contractFile),
  contract_sha256: sha256(contractFile),
  base_rust_source: path.relative(root, baseSourceFile),
  base_rust_sha256: sha256(baseSourceFile),
  mutation_count: mutations.length,
  ordinary_comparator: {
    openapi: "benchmarks/001-post-users/verification/baseline/openapi.json",
    runtime_capability_manifest: path.relative(root, manualManifestFile),
    dependency_policy: path.relative(root, manualDependencyPolicyFile),
    additional_tests: "benchmark-runner/verification-experiment/ordinary-additional.mjs",
  },
  mutations: mutations.map(({ id, defect, category, expected_baseline_detection, ordinary_equivalent }) => ({
    id,
    defect,
    category,
    expected_baseline_detection,
    ordinary_equivalent,
  })),
  tools: {
    node: process.version,
    rustc: output("rustc", ["--version"]),
    cargo: output("cargo", ["--version"]),
    host_wasmtime_crate: "48.0.1",
  },
});

if (faults.some((observation) => !observation.compile.success)) {
  throw new Error("at least one seeded defect did not compile successfully");
}
if (control.baseline.detected || control.air.detected) {
  throw new Error("the correct control produced a false positive");
}
if (control.ordinary_augmented.detected) {
  throw new Error("the ordinary augmented comparator produced a false positive");
}
process.stdout.write(
  `${JSON.stringify({
    event: "experiment_completed",
    seeded_defects: faults.length,
    baseline_detected: baselineDetected,
    air_detected: airDetected,
    ordinary_augmented_detected: ordinaryDetected,
    verification_lift: lift.length,
  })}\n`,
);

function cargoDependencyMetrics(manifest, cwd) {
  const metadataResult = run("cargo", [
    "metadata",
    "--offline",
    "--format-version",
    "1",
    "--manifest-path",
    manifest,
  ], { cwd });
  if (metadataResult.status !== 0) {
    return { error: metadataResult.stderr || metadataResult.stdout };
  }
  const metadata = JSON.parse(metadataResult.stdout);
  const rootId = metadata.resolve.root;
  const rootNode = metadata.resolve.nodes.find((node) => node.id === rootId);
  const directIds = new Set(rootNode.dependencies);
  const visited = new Set();
  let maximumDepth = 0;
  function visit(id, depth) {
    maximumDepth = Math.max(maximumDepth, depth);
    const node = metadata.resolve.nodes.find((candidate) => candidate.id === id);
    for (const child of node?.dependencies ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        visit(child, depth + 1);
      }
    }
  }
  visit(rootId, 0);
  const rootPackage = metadata.packages.find((candidate) => candidate.id === rootId);
  return {
    direct: directIds.size,
    transitive: Math.max(0, visited.size - directIds.size),
    graph_depth: maximumDepth,
    build_scripts: rootPackage.targets.some((target) => target.kind.includes("custom-build")),
  };
}

function evaluateDependencyLimits(metrics, limits) {
  if (metrics.error) return { passed: false, diagnostics: [metrics.error] };
  const diagnostics = [];
  if (metrics.direct > limits.maximum_direct) diagnostics.push("direct dependency limit exceeded");
  if (metrics.transitive > limits.maximum_transitive) diagnostics.push("transitive dependency limit exceeded");
  if (metrics.graph_depth > limits.maximum_graph_depth) diagnostics.push("dependency graph depth exceeded");
  if (!limits.build_scripts && metrics.build_scripts) diagnostics.push("build script is forbidden");
  return { passed: diagnostics.length === 0, diagnostics };
}

function compareRuntimeManifests(generated, manual) {
  const normalize = (value) => ({
    imports: value.allowed_imports.map((item) => ({ module: item.module, name: item.name })),
    denied: [...value.denied_categories].sort(),
    resources: value.resources,
  });
  const left = normalize(generated);
  const right = normalize(manual);
  return {
    equivalent: JSON.stringify(left) === JSON.stringify(right),
    differences: JSON.stringify(left) === JSON.stringify(right) ? [] : [{ generated: left, manual: right }],
  };
}

function detectionStages(observation, mapping) {
  return Object.entries(mapping)
    .filter(([field]) => observation[field])
    .map(([, stage]) => stage);
}

function rebuildControlForSecurity() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "air-verification-security-control-"));
  const retained = path.join(resultRoot, "generated/correct-control.wasm");
  try {
    writeText(path.join(workspace, "Cargo.toml"), candidateManifest);
    writeText(path.join(workspace, "src/lib.rs"), baseSource);
    requireStatusZero(run("cargo", ["generate-lockfile", "--offline"], { cwd: workspace }));
    requireStatusZero(run("cargo", [
      "build",
      "--release",
      "--offline",
      "--target",
      "wasm32-wasip1",
    ], { cwd: workspace, environment: { ...process.env, CARGO_TARGET_DIR: path.join(workspace, "target") } }));
    fs.copyFileSync(
      path.join(workspace, "target/wasm32-wasip1/release/mutation_candidate.wasm"),
      retained,
    );
    return retained;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function requireSuccess(name, command, arguments_) {
  const result = run(command, arguments_, { cwd: root });
  if (result.status !== 0) throw new Error(`${name} failed:\n${result.stdout}${result.stderr}`);
}

function requireStatusZero(result) {
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.environment ?? process.env,
    timeout: options.timeout ?? 300_000,
  });
  return {
    status: result.status,
    signal: result.signal,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? String(result.error ?? ""),
  };
}

function notRun(reason) {
  return { status: null, signal: null, timed_out: false, stdout: "", stderr: "", not_run: reason };
}

function writeCommandResult(file, result) {
  writeJson(file, result);
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function output(command, arguments_) {
  const result = run(command, arguments_);
  requireStatusZero(result);
  return result.stdout.trim();
}
