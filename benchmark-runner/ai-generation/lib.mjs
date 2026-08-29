import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(moduleDirectory, "../..");
export const promptDirectory = path.join(root, "benchmarks/001-post-users/prompts");
export const specification = path.join(root, "benchmarks/001-post-users/spec.md");
export const host = path.join(root, "benchmark-runner/target/release/air-benchmark-host");
export const airCompiler = path.join(root, "target/debug/air");
export const attacks = path.join(root, "benchmarks/001-post-users/attacks");

const targetFiles = {
  air: ["candidate/program.air"],
  "rust-wasm": ["candidate/Cargo.toml", "candidate/src/lib.rs"],
};

const fixedWorkspaceFiles = ["AGENTS.md", "spec.md", "guest-abi.md", "TARGET.md"];

export function experimentConfiguration(arguments_) {
  const values = parseArguments(arguments_);
  const model = values.get("--model") ?? "gpt-5.6-luna";
  const reasoning = values.get("--reasoning") ?? "medium";
  const runs = number(values.get("--runs") ?? "20", "--runs", 1);
  const maxRepairs = number(values.get("--max-repairs") ?? "3", "--max-repairs", 0);
  const timeoutMilliseconds = number(
    values.get("--timeout-ms") ?? "300000",
    "--timeout-ms",
    1,
  );
  const experimentId =
    values.get("--experiment-id") ??
    `b001-${slug(model)}-${slug(reasoning)}-r${runs}-v1`;
  const only = values.get("--only") ?? null;
  return {
    experimentId,
    model,
    reasoning,
    runs,
    maxRepairs,
    timeoutMilliseconds,
    only,
    targets: ["air", "rust-wasm"],
  };
}

export function createExperimentManifest(configuration) {
  const resultRoot = experimentResultRoot(configuration);
  fs.mkdirSync(resultRoot, { recursive: true });
  const promptFiles = {
    common: path.join(promptDirectory, "common.md"),
    agents: path.join(promptDirectory, "AGENTS.md"),
    abi: path.join(promptDirectory, "guest-abi.md"),
    air: path.join(promptDirectory, "air.md"),
    "rust-wasm": path.join(promptDirectory, "rust.md"),
    specification,
  };
  const promptHashes = Object.fromEntries(
    Object.entries(promptFiles).map(([name, file]) => [name, sha256(file)]),
  );
  const promptBytes = Object.fromEntries(
    Object.entries(promptFiles).map(([name, file]) => [name, fs.statSync(file).size]),
  );
  const manifest = {
    schema_version: 1,
    experiment_id: configuration.experimentId,
    benchmark: "001-post-users",
    model: configuration.model,
    reasoning: configuration.reasoning,
    runs_per_target: configuration.runs,
    max_repairs: configuration.maxRepairs,
    timeout_ms_per_model_turn: configuration.timeoutMilliseconds,
    generation_order: "Paired by run number, AIR first on odd runs and Rust first on even runs.",
    sandbox: "workspace-write",
    user_config: "ignored",
    project_rules: "ignored",
    network_instruction: "forbidden",
    build_and_test_tools_during_generation: "forbidden",
    max_output_tokens: null,
    max_output_tokens_unavailable_reason:
      "The installed codex exec interface exposes no per-turn maximum output token flag.",
    context_window: "model default, identical for both targets",
    seed: null,
    seed_unavailable_reason: "The installed codex exec interface exposes no sampling seed.",
    model_call_count_semantics:
      "One logical Codex turn per generation or repair; internal inference-call count is not exposed.",
    prompt_sha256: promptHashes,
    prompt_bytes: promptBytes,
    prompt_files: Object.fromEntries(
      Object.entries(promptFiles).map(([name, file]) => [name, path.relative(root, file)]),
    ),
    codex_cli: commandSync("codex", ["--version"]).stdout.trim(),
    rustc: commandSync("rustc", ["--version"]).stdout.trim(),
    cargo: commandSync("cargo", ["--version"]).stdout.trim(),
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    execution_environment: {
      wasmtime_embedding_crate: "48.0.1",
      guest_memory_bytes: 4 * 1_024 * 1_024,
      fuel_per_request: 10_000_000,
      maximum_instances: 1,
      maximum_memories: 1,
      maximum_tables: 1,
      maximum_table_elements: 1_024,
    },
    created_at: new Date().toISOString(),
  };
  const manifestFile = path.join(resultRoot, "manifest.json");
  if (fs.existsSync(manifestFile)) {
    const existing = readJson(manifestFile);
    for (const field of [
      "experiment_id",
      "model",
      "reasoning",
      "runs_per_target",
      "max_repairs",
      "timeout_ms_per_model_turn",
    ]) {
      if (existing[field] !== manifest[field]) {
        throw new Error(`existing experiment manifest differs at ${field}`);
      }
    }
    if (JSON.stringify(existing.prompt_sha256) !== JSON.stringify(manifest.prompt_sha256)) {
      throw new Error("prompt files changed after the experiment was created");
    }
    return existing;
  }
  writeJson(manifestFile, manifest);
  return manifest;
}

export function experimentResultRoot(configuration) {
  return path.join(
    root,
    "results/001-post-users/generation",
    configuration.experimentId,
  );
}

export function runResultFile(configuration, target, runNumber) {
  return path.join(
    experimentResultRoot(configuration),
    target,
    `run-${String(runNumber).padStart(3, "0")}.json`,
  );
}

export function makeSchedule(configuration) {
  const schedule = [];
  for (let runNumber = 1; runNumber <= configuration.runs; runNumber += 1) {
    const order = runNumber % 2 === 1 ? configuration.targets : [...configuration.targets].reverse();
    for (const target of order) {
      if (!configuration.only || configuration.only === `${target}:${runNumber}`) {
        schedule.push({ target, runNumber });
      }
    }
  }
  return schedule;
}

export function initializeRun(configuration, target, runNumber, manifest) {
  const resultFile = runResultFile(configuration, target, runNumber);
  if (fs.existsSync(resultFile)) {
    return readJson(resultFile);
  }
  const workspace = path.join(
    os.tmpdir(),
    "air-benchmark-001-ai-generation",
    configuration.experimentId,
    target,
    `run-${String(runNumber).padStart(3, "0")}`,
  );
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(path.join(workspace, "candidate"), { recursive: true });
  copy(path.join(promptDirectory, "AGENTS.md"), path.join(workspace, "AGENTS.md"));
  copy(specification, path.join(workspace, "spec.md"));
  copy(path.join(promptDirectory, "guest-abi.md"), path.join(workspace, "guest-abi.md"));
  copy(
    path.join(promptDirectory, target === "air" ? "air.md" : "rust.md"),
    path.join(workspace, "TARGET.md"),
  );
  const result = {
    schema_version: 1,
    experiment_id: configuration.experimentId,
    benchmark: "001-post-users",
    target,
    run: runNumber,
    run_id: `${configuration.experimentId}-${target}-${String(runNumber).padStart(3, "0")}`,
    model: manifest.model,
    reasoning: manifest.reasoning,
    seed: null,
    workspace,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "in_progress",
    attempts: [],
    first_pass: null,
    final: null,
    repair_iterations: 0,
    regressions_introduced: 0,
  };
  saveRun(configuration, result);
  return result;
}

export async function executeAttempt(configuration, result) {
  const attemptNumber = result.attempts.length;
  const isRepair = attemptNumber > 0;
  const diagnostics = isRepair ? repairPrompt(result.attempts.at(-1)) : initialPrompt();
  const rawDirectory = path.join(
    experimentResultRoot(configuration),
    "raw",
    result.target,
    `run-${String(result.run).padStart(3, "0")}`,
  );
  fs.mkdirSync(rawDirectory, { recursive: true });
  const eventsFile = path.join(rawDirectory, `attempt-${attemptNumber}-codex.jsonl`);
  const stderrFile = path.join(rawDirectory, `attempt-${attemptNumber}-codex.stderr.txt`);
  const lastMessageFile = path.join(rawDirectory, `attempt-${attemptNumber}-last-message.txt`);

  const threadId = result.attempts[0]?.codex.thread_id ?? null;
  const invocation = await invokeCodex({
    configuration,
    workspace: result.workspace,
    prompt: diagnostics,
    threadId,
    lastMessageFile,
  });
  fs.writeFileSync(eventsFile, invocation.stdout);
  fs.writeFileSync(stderrFile, invocation.stderr);

  const events = parseEvents(invocation.stdout);
  const codex = summarizeCodex(invocation, events, result.workspace, eventsFile, stderrFile);
  const candidate = snapshotCandidate(configuration, result, attemptNumber, codex);
  const evaluation = await evaluateCandidate(configuration, result, attemptNumber, candidate);
  const previous = result.attempts.at(-1)?.evaluation ?? null;
  const regression = previous ? detectRegression(previous, evaluation) : null;
  const attempt = {
    attempt: attemptNumber,
    kind: isRepair ? "repair" : "generation",
    diagnostics_sent: isRepair ? diagnostics : null,
    prompt_bytes: Buffer.byteLength(diagnostics),
    prompt_sha256: hashText(diagnostics),
    codex,
    candidate,
    evaluation,
    regression,
  };
  result.attempts.push(attempt);
  if (regression?.introduced) result.regressions_introduced += 1;
  if (attemptNumber === 0) result.first_pass = outcome(attempt);
  result.final = outcome(attempt);
  result.repair_iterations = attemptNumber;
  if (evaluation.full_success || attemptNumber >= configuration.maxRepairs) {
    result.status = "completed";
    result.completed_at = new Date().toISOString();
  }
  saveRun(configuration, result);
  return result;
}

function initialPrompt() {
  return fs.readFileSync(path.join(promptDirectory, "common.md"), "utf8");
}

function repairPrompt(previousAttempt) {
  const evaluation = previousAttempt.evaluation;
  const lines = [
    "The independent evaluator rejected the current candidate.",
    "Revise only the required files under candidate/.",
    "Do not inspect outside this workspace and do not run any compiler, test, package manager, network command, or external development tool.",
    "Use only the following diagnostics from the normal automated development loop.",
    "Do not hardcode around individual failing cases.",
    "",
    `Primary failure category: ${evaluation.failure.primary_category}`,
    `Parse success: ${evaluation.parse_success}`,
    `Compile success: ${evaluation.compile_success}`,
    `Runtime startup success: ${evaluation.runtime_startup_success}`,
    `Functional tests: ${evaluation.functional.tests_passed}/${evaluation.functional.tests_total}`,
    `Security tests: ${evaluation.security.tests_passed}/${evaluation.security.tests_total}`,
  ];
  if (evaluation.gaming.violations.length > 0) {
    lines.push("Anti-gaming diagnostics:");
    for (const violation of evaluation.gaming.violations) lines.push(`- ${violation}`);
  }
  if (evaluation.compile_diagnostic) {
    lines.push("Compiler or verifier diagnostic:", truncate(evaluation.compile_diagnostic, 6_000));
  }
  if (evaluation.startup_diagnostic) {
    lines.push("Startup diagnostic:", truncate(evaluation.startup_diagnostic, 3_000));
  }
  const failures = evaluation.functional.failures;
  if (failures.length > 0) {
    lines.push("Black-box functional diagnostics:");
    for (const failure of failures) {
      lines.push(`- ${failure.test}: ${truncate(failure.failure ?? "failed", 600)}`);
    }
  }
  if (evaluation.security.failures.length > 0) {
    lines.push("Security diagnostics:");
    for (const failure of evaluation.security.failures) lines.push(`- ${failure}`);
  }
  lines.push("Create the revised candidate files now, then stop.");
  return `${lines.join("\n")}\n`;
}

async function invokeCodex({ configuration, workspace, prompt, threadId, lastMessageFile }) {
  const codex = "codex";
  const common = [
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    lastMessageFile,
    "--model",
    configuration.model,
    "--config",
    `model_reasoning_effort=\"${configuration.reasoning}\"`,
    "--config",
    'sandbox_mode="workspace-write"',
    "--config",
    "sandbox_workspace_write.network_access=false",
  ];
  const args = threadId
    ? ["exec", "resume", ...common, threadId, "-"]
    : [
        "exec",
        ...common,
        "--sandbox",
        "workspace-write",
        "--cd",
        workspace,
        "-",
      ];
  return spawnCapture(codex, args, {
    cwd: workspace,
    input: prompt,
    timeoutMilliseconds: configuration.timeoutMilliseconds,
    environment: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ type: "unparseable", raw: line });
    }
  }
  return events;
}

function summarizeCodex(invocation, events, workspace, eventsFile, stderrFile) {
  const completion = [...events].reverse().find((event) => event.type === "turn.completed");
  const thread = events.find((event) => event.type === "thread.started");
  const commands = events
    .filter(
      (event) =>
        event.type === "item.completed" && event.item?.type === "command_execution",
    )
    .map((event) => event.item.command)
    .filter(Boolean);
  const messages = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text ?? "");
  const usage = completion?.usage ?? null;
  return {
    thread_id: thread?.thread_id ?? null,
    exit_code: invocation.exitCode,
    signal: invocation.signal,
    timed_out: invocation.timedOut,
    latency_ms: round(invocation.elapsedMilliseconds),
    usage: usage
      ? {
          input_tokens: usage.input_tokens ?? null,
          cached_input_tokens: usage.cached_input_tokens ?? null,
          output_tokens: usage.output_tokens ?? null,
          reasoning_output_tokens: usage.reasoning_output_tokens ?? null,
          total_tokens:
            Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
              ? usage.input_tokens + usage.output_tokens
              : null,
        }
      : null,
    logical_model_turns: completion ? 1 : 0,
    internal_model_calls: null,
    internal_model_calls_unavailable_reason:
      "codex exec reports aggregate turn usage, not internal inference-call count.",
    agent_message_bytes: Buffer.byteLength(messages.join("\n")),
    commands,
    command_policy_violations: commandPolicyViolations(commands, workspace),
    raw_events: path.relative(root, eventsFile),
    raw_stderr: path.relative(root, stderrFile),
  };
}

function snapshotCandidate(configuration, result, attemptNumber, codex) {
  const workspaceFiles = listFiles(result.workspace).map((file) => path.relative(result.workspace, file));
  const expected = targetFiles[result.target];
  const unexpected = workspaceFiles.filter(
    (file) => !fixedWorkspaceFiles.includes(file) && !expected.includes(file),
  );
  const changedInputs = fixedWorkspaceFiles.filter((file) => {
    const current = path.join(result.workspace, file);
    const source = sourceForWorkspaceFile(result.target, file);
    return !fs.existsSync(current) || sha256(current) !== sha256(source);
  });
  const missing = expected.filter((file) => !fs.existsSync(path.join(result.workspace, file)));
  const snapshot = path.join(
    experimentResultRoot(configuration),
    "candidates",
    result.target,
    `run-${String(result.run).padStart(3, "0")}`,
    `attempt-${attemptNumber}`,
  );
  fs.rmSync(snapshot, { recursive: true, force: true });
  fs.mkdirSync(snapshot, { recursive: true });
  const files = [];
  for (const relative of expected) {
    const source = path.join(result.workspace, relative);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(snapshot, relative.replace(/^candidate\//, ""));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    copy(source, destination);
    files.push({
      path: relative,
      bytes: fs.statSync(source).size,
      sha256: sha256(source),
    });
  }
  const combined = files.map((file) => fs.readFileSync(path.join(result.workspace, file.path))).flat();
  return {
    expected_files: expected,
    files,
    missing_files: missing,
    unexpected_files: unexpected,
    changed_input_files: changedInputs,
    source_bytes: files.reduce((total, file) => total + file.bytes, 0),
    combined_sha256: hashBuffers(combined),
    snapshot_directory: path.relative(root, snapshot),
    command_policy_violations: codex.command_policy_violations,
  };
}

async function evaluateCandidate(configuration, result, attemptNumber, candidate) {
  const evaluationDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), `air-b001-eval-${result.target}-${result.run}-${attemptNumber}-`),
  );
  const rawDirectory = path.join(
    experimentResultRoot(configuration),
    "raw",
    result.target,
    `run-${String(result.run).padStart(3, "0")}`,
  );
  const evaluationLog = path.join(rawDirectory, `attempt-${attemptNumber}-evaluation.txt`);
  const functionalFile = path.join(rawDirectory, `attempt-${attemptNumber}-functional.json`);
  const securityFile = path.join(rawDirectory, `attempt-${attemptNumber}-security.json`);
  const log = [];
  const gaming = detectGaming(result, candidate);
  let parseSuccess = false;
  let compileSuccess = false;
  let compileDiagnostic = "";
  let artifact = null;
  let artifactPath = null;
  let buildMilliseconds = null;

  try {
    if (candidate.missing_files.length > 0 || candidate.unexpected_files.length > 0) {
      compileDiagnostic = "Required candidate file set is incomplete or contains extra files.";
    } else if (result.target === "rust-wasm" && rustPreflight(result.workspace).length > 0) {
      compileDiagnostic = rustPreflight(result.workspace).join("\n");
      parseSuccess = true;
    } else if (result.target === "air") {
      const source = path.join(result.workspace, "candidate/program.air");
      const checked = await spawnCapture(airCompiler, ["check", source], {
        cwd: root,
        timeoutMilliseconds: 30_000,
      });
      logCommand(log, "air check", checked);
      parseSuccess = checked.exitCode === 0 || !isParseDiagnostic(checked.stderr);
      if (checked.exitCode === 0) {
        artifactPath = path.join(evaluationDirectory, "candidate.wasm");
        const built = await timedSpawn(airCompiler, ["build", source, "-o", artifactPath], {
          cwd: root,
          timeoutMilliseconds: 30_000,
        });
        buildMilliseconds = built.elapsedMilliseconds;
        logCommand(log, "air build", built);
        compileSuccess = built.exitCode === 0 && fs.existsSync(artifactPath);
        compileDiagnostic = cleanDiagnostic(built.stderr || built.stdout, result.workspace);
      } else {
        compileDiagnostic = cleanDiagnostic(checked.stderr || checked.stdout, result.workspace);
      }
    } else {
      const copiedCandidate = path.join(evaluationDirectory, "candidate");
      fs.cpSync(path.join(result.workspace, "candidate"), copiedCandidate, { recursive: true });
      const targetDirectory = path.join(evaluationDirectory, "target");
      const built = await timedSpawn(
        "cargo",
        [
          "build",
          "--release",
          "--offline",
          "--target",
          "wasm32-wasip1",
          "--manifest-path",
          path.join(copiedCandidate, "Cargo.toml"),
        ],
        {
          cwd: copiedCandidate,
          timeoutMilliseconds: 120_000,
          environment: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
        },
      );
      buildMilliseconds = built.elapsedMilliseconds;
      logCommand(log, "cargo build", built);
      parseSuccess = built.exitCode === 0 || !isRustParseDiagnostic(`${built.stdout}\n${built.stderr}`);
      artifactPath = path.join(targetDirectory, "wasm32-wasip1/release/candidate.wasm");
      compileSuccess = built.exitCode === 0 && fs.existsSync(artifactPath);
      compileDiagnostic = cleanDiagnostic(built.stderr || built.stdout, result.workspace);
    }

    if (compileSuccess) {
      artifact = {
        bytes: fs.statSync(artifactPath).size,
        sha256: sha256(artifactPath),
      };
    }

    let runtimeStartupSuccess = false;
    let startupDiagnostic = "";
    if (compileSuccess) {
      const startup = await spawnCapture(host, ["inspect", "--wasm", artifactPath], {
        cwd: root,
        timeoutMilliseconds: 30_000,
      });
      logCommand(log, "shared host inspect", startup);
      runtimeStartupSuccess = startup.exitCode === 0;
      startupDiagnostic = cleanDiagnostic(startup.stderr || startup.stdout, result.workspace);
    }

    let functional = emptyFunctional();
    let security = emptySecurity();
    if (compileSuccess && runtimeStartupSuccess) {
      const functionalRun = await spawnCapture(
        "node",
        [
          "--disable-warning=ExperimentalWarning",
          "benchmark-runner/functional.mjs",
          "--host",
          host,
          "--wasm",
          artifactPath,
          "--target",
          result.target,
          "--output",
          functionalFile,
        ],
        { cwd: root, timeoutMilliseconds: 120_000 },
      );
      logCommand(log, "functional harness", functionalRun);
      if (fs.existsSync(functionalFile)) {
        const value = readJson(functionalFile).correctness;
        functional = {
          tests_passed: value.tests_passed,
          tests_total: value.tests_total,
          full_success: value.full_test_success,
          failures: value.tests
            .filter((test) => !test.passed)
            .map((test) => ({ test: test.name, failure: test.failure })),
        };
      } else {
        const functionalDiagnostic = cleanDiagnostic(
          functionalRun.stderr || functionalRun.stdout,
          result.workspace,
        );
        if (/host exited before listening|failed to start|startup/i.test(functionalDiagnostic)) {
          runtimeStartupSuccess = false;
          startupDiagnostic = [startupDiagnostic, functionalDiagnostic]
            .filter(Boolean)
            .join("\n");
        }
        functional.failures.push({
          test: "harness_startup",
          failure: functionalDiagnostic,
        });
      }

      const airSource =
        result.target === "air"
          ? path.join(result.workspace, "candidate/program.air")
          : path.join(root, "benchmarks/001-post-users/air/program.air");
      const securityRun = await spawnCapture(
        "node",
        [
          "benchmark-runner/security.mjs",
          "--host",
          host,
          "--wasm",
          artifactPath,
          "--target",
          result.target,
          "--air-source",
          airSource,
          "--air-compiler",
          airCompiler,
          "--attacks",
          attacks,
          "--output",
          securityFile,
        ],
        { cwd: root, timeoutMilliseconds: 60_000 },
      );
      logCommand(log, "security harness", securityRun);
      if (fs.existsSync(securityFile)) {
        const value = readJson(securityFile).security;
        security = {
          tests_passed: value.undeclared_access_attempts - value.undeclared_access_successes,
          tests_total: value.undeclared_access_attempts,
          undeclared_access_successes: value.undeclared_access_successes,
          failures: value.attacks
            .filter((attack) => attack.successful_undeclared_access)
            .map((attack) => attack.attack),
          blocked_stages: value.attacks.map((attack) => ({
            attack: attack.attack,
            stage: attack.blocked_stage,
          })),
        };
      } else {
        security.failures.push(
          cleanDiagnostic(securityRun.stderr || securityRun.stdout, result.workspace),
        );
      }
    }

    const failure = classifyFailure({
      result,
      candidate,
      gaming,
      parseSuccess,
      compileSuccess,
      compileDiagnostic,
      runtimeStartupSuccess,
      startupDiagnostic,
      functional,
      security,
    });
    const fullSuccess =
      gaming.violations.length === 0 &&
      compileSuccess &&
      runtimeStartupSuccess &&
      functional.full_success &&
      security.tests_total === 8 &&
      security.tests_passed === 8;
    fs.writeFileSync(evaluationLog, `${log.join("\n\n")}\n`);
    return {
      parse_success: parseSuccess,
      compile_success: compileSuccess,
      runtime_startup_success: runtimeStartupSuccess,
      full_success: fullSuccess,
      incorrect_but_compiling: compileSuccess && !fullSuccess,
      compile_diagnostic: compileDiagnostic || null,
      startup_diagnostic: startupDiagnostic || null,
      build_ms: buildMilliseconds === null ? null : round(buildMilliseconds),
      artifact,
      representation: representationMetrics(result.target, candidate),
      functional,
      security,
      gaming,
      failure,
      raw_evaluation_log: path.relative(root, evaluationLog),
      raw_functional_result: fs.existsSync(functionalFile)
        ? path.relative(root, functionalFile)
        : null,
      raw_security_result: fs.existsSync(securityFile) ? path.relative(root, securityFile) : null,
    };
  } finally {
    fs.rmSync(evaluationDirectory, { recursive: true, force: true });
  }
}

function representationMetrics(target, candidate) {
  return {
    source_bytes: candidate.source_bytes,
    direct_dependencies: 0,
    transitive_dependencies: 0,
    dependency_graph_depth: 0,
    build_steps: 1,
    generated_files: candidate.files.length,
    declared_capabilities: target === "air" ? 3 : 1,
    effective_guest_imports: 1,
  };
}

function detectGaming(result, candidate) {
  const violations = [];
  if (candidate.changed_input_files.length > 0) {
    violations.push("The generator modified immutable input files.");
  }
  if (candidate.unexpected_files.length > 0) {
    violations.push("The generator created files outside the permitted candidate file set.");
  }
  for (const violation of candidate.command_policy_violations) violations.push(violation);
  const text = candidate.files
    .map((file) => fs.readFileSync(path.join(result.workspace, file.path), "utf8"))
    .join("\n");
  const fixturePatterns = [
    /Robert'\); DROP TABLE users;--/,
    /Zoë 東京/,
    /concurrent-[0-9]/i,
    /warmup-[0-9]/i,
    /latency-[0-9]/i,
    /throughput-[0-9]/i,
    /benchmark-runner/i,
    /functional\.mjs/i,
    /security\.mjs/i,
  ];
  if (fixturePatterns.some((pattern) => pattern.test(text))) {
    violations.push("Candidate source contains hidden-harness or fixture-specific material.");
  }
  if (
    result.target === "rust-wasm" &&
    /(std::env|option_env!|env!|include!|include_bytes!|include_str!|std::process::Command)/.test(text)
  ) {
    violations.push("Rust source requests compile-time host data or process access.");
  }
  return { detected: violations.length > 0, violations: [...new Set(violations)] };
}

function commandPolicyViolations(commands, workspace) {
  const violations = [];
  for (const command of commands) {
    const value = Array.isArray(command) ? command.join(" ") : String(command);
    if (/(^|[ ;])(cargo|rustc|air|node|npm|npx|curl|wget|python3?|git)([ ;]|$)/i.test(value)) {
      violations.push("The generator invoked a forbidden compiler, build, network, or external development command.");
    }
    if (/printenv|\benv\b|\.\.[/\\]|\/Users\/|\/home\/|find\s+\//i.test(value)) {
      violations.push("The generator attempted to inspect outside the isolated workspace or read process environment data.");
    }
    if (value.includes(workspace)) continue;
  }
  return [...new Set(violations)];
}

function rustPreflight(workspace) {
  const failures = [];
  const manifest = fs.readFileSync(path.join(workspace, "candidate/Cargo.toml"), "utf8");
  const source = fs.readFileSync(path.join(workspace, "candidate/src/lib.rs"), "utf8");
  if (!/^\s*name\s*=\s*["']candidate["']/m.test(manifest)) {
    failures.push("Cargo package name must be `candidate`.");
  }
  if (!/crate-type\s*=\s*\[[^\]]*["']cdylib["']/s.test(manifest)) {
    failures.push("Cargo library crate type must include `cdylib`.");
  }
  if (/^\s*(build|workspace)\s*=|^\s*\[(workspace|patch|replace|build-dependencies|dev-dependencies)/m.test(manifest)) {
    failures.push("Cargo manifest requests a forbidden workspace, build script, or dependency override.");
  }
  const dependencySection =
    manifest.match(/^\s*\[dependencies\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m)?.[1] ?? "";
  if (/^\s*[A-Za-z0-9_-]+\s*=/m.test(dependencySection)) {
    failures.push("Third-party Rust dependencies are forbidden in the controlled trial.");
  }
  if (/(include!|include_bytes!|include_str!|option_env!|env!|std::process::Command)/.test(source)) {
    failures.push("Rust source requests forbidden compile-time host data or process execution.");
  }
  return failures;
}

function classifyFailure(context) {
  if (context.gaming.violations.length > 0) {
    return categories("test_specific_hardcoding", []);
  }
  if (context.candidate.missing_files.length > 0) {
    return categories("dependency_build_failure", []);
  }
  const diagnostic = `${context.compileDiagnostic}\n${context.startupDiagnostic}`;
  if (!context.parseSuccess) return categories("syntax_parse_error", []);
  if (!context.compileSuccess) {
    if (/capability.*without declaring|missing capability/i.test(diagnostic)) {
      return categories("missing_capability_declaration", []);
    }
    if (/capability|digest|signed|effect/i.test(diagnostic)) {
      return categories("invalid_capability_declaration", []);
    }
    if (/dependency|Cargo manifest|offline|build script|package name|crate type/i.test(diagnostic)) {
      return categories("dependency_build_failure", []);
    }
    if (/mismatched types|cannot find|trait bound|borrow|lifetime|type/i.test(diagnostic)) {
      return categories("type_error", []);
    }
    return categories("compilation_error", []);
  }
  if (!context.runtimeStartupSuccess) {
    if (/import|export|WebAssembly|wasm|incompatible type/i.test(diagnostic)) {
      return categories("linker_wasm_error", ["incorrect_api_assumption"]);
    }
    return categories("startup_runtime_failure", []);
  }
  if (context.security.tests_passed !== context.security.tests_total) {
    return categories("security_capability_violation", []);
  }
  if (!context.functional.full_success) {
    const names = context.functional.failures.map((failure) => failure.test);
    if (names.includes("concurrent inserts")) return categories("concurrency_bug", []);
    if (
      names.some((name) =>
        ["invalid email", "missing name", "missing email", "empty name", "malformed JSON", "large input", "Unicode input"].includes(name),
      )
    ) {
      return categories("validation_bug", ["wrong_http_behaviour"]);
    }
    if (
      names.some((name) =>
        ["duplicate email", "SQL-injection-like input", "database unavailable"].includes(name),
      )
    ) {
      return categories("persistence_bug", ["wrong_http_behaviour"]);
    }
    return categories("wrong_http_behaviour", []);
  }
  return categories(null, []);
}

function categories(primary, secondary) {
  return { primary_category: primary, secondary_categories: secondary };
}

function detectRegression(previous, current) {
  const changes = [];
  if (previous.parse_success && !current.parse_success) changes.push("parse_success");
  if (previous.compile_success && !current.compile_success) changes.push("compile_success");
  if (previous.runtime_startup_success && !current.runtime_startup_success) {
    changes.push("runtime_startup_success");
  }
  if (current.functional.tests_passed < previous.functional.tests_passed) {
    changes.push("functional_tests_passed");
  }
  if (current.security.tests_passed < previous.security.tests_passed) {
    changes.push("security_tests_passed");
  }
  return { introduced: changes.length > 0, regressed_metrics: changes };
}

function outcome(attempt) {
  const evaluation = attempt.evaluation;
  return {
    attempt: attempt.attempt,
    parse_success: evaluation.parse_success,
    compile_success: evaluation.compile_success,
    runtime_startup_success: evaluation.runtime_startup_success,
    functional_tests_passed: evaluation.functional.tests_passed,
    functional_tests_total: evaluation.functional.tests_total,
    security_tests_passed: evaluation.security.tests_passed,
    security_tests_total: evaluation.security.tests_total,
    full_success: evaluation.full_success,
    incorrect_but_compiling: evaluation.incorrect_but_compiling,
    failure_category: evaluation.failure.primary_category,
  };
}

function emptyFunctional() {
  return { tests_passed: 0, tests_total: 12, full_success: false, failures: [] };
}

function emptySecurity() {
  return {
    tests_passed: 0,
    tests_total: 8,
    undeclared_access_successes: null,
    failures: [],
    blocked_stages: [],
  };
}

function isParseDiagnostic(value) {
  return /(?:^|\n)\s*(?:air:\s*)?\d+:\d+:| at line \d+, column \d+|unexpected (token|end|content)|expected .* at line/i.test(value);
}

function isRustParseDiagnostic(value) {
  return /expected (one of|expression|item|identifier)|unexpected closing delimiter|unclosed delimiter|unknown start of token|prefix .* is unknown/i.test(value);
}

function sourceForWorkspaceFile(target, file) {
  const mapping = {
    "AGENTS.md": path.join(promptDirectory, "AGENTS.md"),
    "spec.md": specification,
    "guest-abi.md": path.join(promptDirectory, "guest-abi.md"),
    "TARGET.md": path.join(promptDirectory, target === "air" ? "air.md" : "rust.md"),
  };
  return mapping[file];
}

function saveRun(configuration, result) {
  writeJson(runResultFile(configuration, result.target, result.run), result);
}

function cleanDiagnostic(value, workspace) {
  return truncate(String(value).replaceAll(workspace, "<workspace>").replaceAll(root, "<benchmark>"), 12_000).trim();
}

function logCommand(log, name, result) {
  log.push(
    `${name}\nexit=${result.exitCode} timeout=${result.timedOut} elapsed_ms=${round(result.elapsedMilliseconds)}\n${result.stdout}${result.stderr}`,
  );
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashBuffers(buffers) {
  const hash = crypto.createHash("sha256");
  for (const buffer of buffers) hash.update(buffer);
  return hash.digest("hex");
}

function truncate(value, maximum) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n<truncated>`;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${flag}`);
    values.set(flag, value);
  }
  return values;
}

function number(value, flag, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${flag} must be an integer >= ${minimum}`);
  return parsed;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function commandSync(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    shell: options.shell ?? false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} failed: ${result.stderr}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export async function spawnCapture(
  command,
  arguments_,
  { cwd = root, input = null, timeoutMilliseconds = 30_000, environment = process.env } = {},
) {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5_000).unref();
    }, timeoutMilliseconds);
    child.on("error", (error) => {
      stderr += String(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        elapsedMilliseconds: performance.now() - start,
      });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function timedSpawn(command, arguments_, options) {
  return spawnCapture(command, arguments_, options);
}
