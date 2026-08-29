import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? "5");
if (!Number.isInteger(iterations) || iterations < 1) {
  throw new Error("BENCHMARK_ITERATIONS must be a positive integer");
}

const rawDirectory = path.join(root, "results/001-post-users/raw");
const airArtifact = path.join(root, "target/benchmarks/air-post-users.wasm");
const rustTarget = path.join(root, "target/benchmarks/rust-candidate-build");
const rustArtifact = path.join(
  rustTarget,
  "wasm32-wasip1/release/benchmark_001_post_users_rust.wasm",
);
const host = path.join(root, "benchmark-runner/target/release/air-benchmark-host");

fs.mkdirSync(rawDirectory, { recursive: true });

run("cargo", ["build", "--release", "--locked", "--manifest-path", "benchmark-runner/Cargo.toml"]);
run("cargo", ["build", "--locked", "--bin", "air"]);

const airBuildMilliseconds = timed(() =>
  run("target/debug/air", [
    "build",
    "benchmarks/001-post-users/air/program.air",
    "-o",
    path.relative(root, airArtifact),
  ]),
);

fs.rmSync(rustTarget, { recursive: true, force: true });
const rustBuildMilliseconds = timed(() =>
  run(
    "cargo",
    [
      "build",
      "--release",
      "--locked",
      "--target",
      "wasm32-wasip1",
      "--manifest-path",
      "benchmarks/001-post-users/rust/Cargo.toml",
    ],
    { CARGO_TARGET_DIR: rustTarget },
  ),
);

const targets = [
  {
    id: "air",
    artifact: airArtifact,
    source: path.join(root, "benchmarks/001-post-users/air/program.air"),
    buildMilliseconds: airBuildMilliseconds,
    simplicity: {
      direct_dependencies: 0,
      transitive_dependencies: 0,
      dependency_graph_depth: 0,
      declared_capabilities: 3,
      effective_guest_imports: 1,
      build_steps: 1,
      required_external_tools: ["air compiler"],
      configuration_files: 0,
      runtime_components: ["candidate Wasm", "shared Wasmtime host", "shared SQLite"],
    },
  },
  {
    id: "rust-wasm",
    artifact: rustArtifact,
    source: path.join(root, "benchmarks/001-post-users/rust/src/lib.rs"),
    buildMilliseconds: rustBuildMilliseconds,
    simplicity: {
      direct_dependencies: 0,
      transitive_dependencies: 0,
      dependency_graph_depth: 0,
      declared_capabilities: 1,
      effective_guest_imports: 1,
      build_steps: 1,
      required_external_tools: ["cargo", "rustc"],
      configuration_files: 3,
      runtime_components: ["candidate Wasm", "shared Wasmtime host", "shared SQLite"],
    },
  },
];

const environment = {
  operating_system: commandOutput("sw_vers", ["-productVersion"]),
  architecture: os.arch(),
  cpu: os.cpus()[0]?.model ?? null,
  logical_cpus: os.cpus().length,
  node: commandOutput("node", ["--version"]),
  rustc: commandOutput("rustc", ["--version"]),
  cargo: commandOutput("cargo", ["--version"]),
  wasmtime_embedding_crate: "48.0.1",
  wasi_profile: "wasm32-wasip1 target contract with zero ambient WASI imports linked",
  resource_limits: {
    guest_memory_bytes: 4 * 1024 * 1024,
    fuel_per_request: 10_000_000,
    max_instances: 1,
    max_memories: 1,
    max_tables: 0,
  },
};

const sharedHostDependencies = cargoDependencies("benchmark-runner/Cargo.toml");

const functionalRunsByTarget = new Map(targets.map((target) => [target.id, []]));
for (let runIndex = 1; runIndex <= iterations; runIndex += 1) {
  const order = runIndex % 2 === 1 ? targets : [...targets].reverse();
  for (const target of order) {
    const output = path.join(
      rawDirectory,
      `${target.id}-functional-${String(runIndex).padStart(2, "0")}.json`,
    );
    run("node", [
      "--disable-warning=ExperimentalWarning",
      "benchmark-runner/functional.mjs",
      "--host",
      host,
      "--wasm",
      target.artifact,
      "--target",
      target.id,
      "--output",
      output,
    ]);
    functionalRunsByTarget.get(target.id).push(readJson(output));
  }
}

for (const target of targets) {
  const functionalRuns = functionalRunsByTarget.get(target.id);
  const securityOutput = path.join(rawDirectory, `${target.id}-security.json`);
  run("node", [
    "benchmark-runner/security.mjs",
    "--host",
    host,
    "--wasm",
    target.artifact,
    "--target",
    target.id,
    "--air-source",
    "benchmarks/001-post-users/air/program.air",
    "--air-compiler",
    "target/debug/air",
    "--attacks",
    "benchmarks/001-post-users/attacks",
    "--output",
    securityOutput,
  ]);
  const security = readJson(securityOutput);

  const result = {
    schema_version: 2,
    benchmark: "001-post-users",
    target: target.id,
    run_kind: "engineering_baseline",
    generation: {
      controlled_trials: 0,
      model: null,
      generated_tokens: null,
      repair_tokens: null,
      model_calls: null,
      repair_iterations: null,
      unavailable_reason:
        "The frozen AIR candidate and independent Rust baseline were not produced in a controlled same-model trial with token telemetry.",
    },
    correctness: {
      compile_success: true,
      runtime_success: functionalRuns.every((runResult) => runResult.correctness.tests_total > 0),
      full_test_success_rate: ratio(
        functionalRuns.filter((runResult) => runResult.correctness.full_test_success).length,
        functionalRuns.length,
      ),
      tests_passed: sum(functionalRuns.map((runResult) => runResult.correctness.tests_passed)),
      tests_total: sum(functionalRuns.map((runResult) => runResult.correctness.tests_total)),
      failures: functionalRuns.flatMap((runResult, index) =>
        runResult.correctness.tests
          .filter((test) => !test.passed)
          .map((test) => ({ run: index + 1, test: test.name, failure: test.failure })),
      ),
    },
    security: security.security,
    simplicity: {
      ...target.simplicity,
      generated_representation_bytes: fs.statSync(target.source).size,
      artifact_bytes: fs.statSync(target.artifact).size,
      shared_host_dependencies: sharedHostDependencies,
    },
    build: {
      candidate_build_ms: round(target.buildMilliseconds),
      cache_condition:
        target.id === "rust-wasm"
          ? "fresh candidate Cargo target directory"
          : "fresh AIR output using an already-built AIR compiler executable",
    },
    artifact: functionalRuns[0].artifact,
    performance: summarizePerformance(functionalRuns),
    environment,
    raw_results: functionalRuns.map((_, index) =>
      path.relative(
        root,
        path.join(
          rawDirectory,
          `${target.id}-functional-${String(index + 1).padStart(2, "0")}.json`,
        ),
      ),
    ).concat(path.relative(root, securityOutput)),
  };

  fs.writeFileSync(
    path.join(root, `results/001-post-users/engineering-${target.id}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

run("node", ["benchmark-runner/report.mjs"]);

function summarizePerformance(runs) {
  const names = [
    "cold_start_ms",
    "mean_request_ms",
    "median_request_ms",
    "p95_request_ms",
    "throughput_requests_per_second",
    "peak_memory_bytes",
    "user_cpu_seconds",
    "system_cpu_seconds",
  ];
  return Object.fromEntries(
    names.map((name) => {
      const samples = runs.map((runResult) => runResult.performance[name]);
      return [name, { mean: round(mean(samples)), median: round(median(samples)), samples }];
    }),
  );
}

function cargoDependencies(manifest) {
  const metadata = JSON.parse(
    commandOutput("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest]),
  );
  const rootPackage = metadata.packages.find((candidate) => candidate.name === "air-benchmark-runner");
  const byId = new Map(metadata.packages.map((candidate) => [candidate.id, candidate]));
  const resolve = new Map(metadata.resolve.nodes.map((node) => [node.id, node.dependencies]));
  const visited = new Set();
  let maximumDepth = 0;
  function visit(id, depth) {
    maximumDepth = Math.max(maximumDepth, depth);
    for (const child of resolve.get(id) ?? []) {
      if (child === rootPackage.id) continue;
      visited.add(child);
      visit(child, depth + 1);
    }
  }
  visit(rootPackage.id, 0);
  return {
    direct: rootPackage.dependencies.length,
    transitive: visited.size - rootPackage.dependencies.length,
    graph_depth: maximumDepth,
    packages: [...visited].map((id) => byId.get(id)?.name).filter(Boolean).sort(),
    note: "Common benchmark infrastructure, excluded from candidate dependency counts.",
  };
}

function run(command, arguments_, extraEnvironment = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result;
}

function commandOutput(command, arguments_) {
  const result = run(command, arguments_);
  return result.stdout.trim();
}

function timed(action) {
  const start = performance.now();
  action();
  return performance.now() - start;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return sum(values) / values.length;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function ratio(numerator, denominator) {
  return round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
