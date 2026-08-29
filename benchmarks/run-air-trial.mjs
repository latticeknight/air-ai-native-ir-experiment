import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const options = parseArguments(process.argv.slice(2));
const source = path.resolve("benchmarks/001-post-users/air/program.air");
const artifact = path.resolve("target/benchmarks/001-post-users.wasm");
fs.mkdirSync(path.dirname(artifact), { recursive: true });

const compileStart = performance.now();
const compile = spawnSync(
  "cargo",
  ["run", "--quiet", "--", "build", source, "-o", artifact],
  { encoding: "utf8" },
);
const compileMilliseconds = performance.now() - compileStart;
const compileSuccess = compile.status === 0;

let runtimeSuccess = false;
let contractSuccess = false;
let runtimeTestMilliseconds = 0;
let failure = compileSuccess ? null : compile.stderr.trim() || compile.stdout.trim();
if (compileSuccess) {
  const contract = spawnSync("cargo", ["test", "--quiet", "--test", "service_contract"], {
    encoding: "utf8",
  });
  contractSuccess = contract.status === 0;
  if (!contractSuccess) failure = contract.stderr.trim() || contract.stdout.trim();

  const runtimeStart = performance.now();
  const runtime = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "tests/service-e2e.mjs",
      artifact,
    ],
    { encoding: "utf8" },
  );
  runtimeTestMilliseconds = performance.now() - runtimeStart;
  runtimeSuccess = runtime.status === 0;
  if (!runtimeSuccess && failure === null) failure = runtime.stderr.trim() || runtime.stdout.trim();
}

const result = {
  schema_version: 1,
  target: "air",
  benchmark: "001-post-users",
  trial_id: options.trialId,
  generated_tokens: options.generatedTokens,
  repair_tokens: options.repairTokens,
  model_calls: options.modelCalls,
  compile_success: compileSuccess,
  runtime_success: runtimeSuccess,
  tests_passed: (contractSuccess ? 5 : 0) + (runtimeSuccess ? 13 : 0),
  tests_total: 18,
  repair_iterations: options.repairIterations,
  direct_dependencies: 3,
  transitive_dependencies: 0,
  dependency_graph_depth: 1,
  capability_violations: contractSuccess ? 0 : 1,
  artifact_bytes: compileSuccess ? fs.statSync(artifact).size : 0,
  source_bytes: fs.statSync(source).size,
  compile_milliseconds: round(compileMilliseconds),
  runtime_test_milliseconds: round(runtimeTestMilliseconds),
  failure,
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (options.output !== null) {
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(options.output, json);
}
process.stdout.write(json);
process.exit(compileSuccess && contractSuccess && runtimeSuccess ? 0 : 1);

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
  }
  const required = [
    "--trial-id",
    "--generated-tokens",
    "--repair-tokens",
    "--model-calls",
    "--repair-iterations",
  ];
  for (const flag of required) {
    if (!values.has(flag)) {
      throw new Error(`missing required benchmark provenance ${flag}`);
    }
  }
  return {
    trialId: values.get("--trial-id"),
    generatedTokens: integer(values.get("--generated-tokens"), "--generated-tokens", 0),
    repairTokens: integer(values.get("--repair-tokens"), "--repair-tokens", 0),
    modelCalls: integer(values.get("--model-calls"), "--model-calls", 1),
    repairIterations: integer(values.get("--repair-iterations"), "--repair-iterations", 0),
    output: values.get("--output") ?? null,
  };
}

function integer(value, flag, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
