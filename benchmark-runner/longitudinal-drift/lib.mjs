import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { evaluateProject } from "../../experiments/longitudinal-drift/oracle/evaluate.mjs";
import {
  protocol,
  repositoryRoot,
  requirements,
  stateAt,
} from "../../experiments/longitudinal-drift/oracle/state.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const experimentRoot = path.resolve(moduleDirectory, "../../experiments/longitudinal-drift");
const publicRoot = path.join(repositoryRoot, "results/001-post-users/longitudinal-drift");
const privateRoot = path.join(repositoryRoot, ".private/longitudinal-drift");

export function configuration(arguments_) {
  const values = parseArguments(arguments_);
  const result = {
    experimentId: values.get("--experiment-id") ?? "preregistered-v1",
    chains: integer(values.get("--chains") ?? String(protocol.chains_per_pipeline), "--chains", 1),
    throughVersion: integer(
      values.get("--through-version") ?? String(protocol.versions_per_chain),
      "--through-version",
      1,
    ),
    only: values.get("--only") ?? null,
    dryRun: values.has("--dry-run"),
  };
  if (result.experimentId === "preregistered-v1" && result.dryRun) {
    throw new Error("the preregistered result ID cannot be used for a dry run");
  }
  if (result.experimentId === "preregistered-v1" && result.chains !== protocol.chains_per_pipeline) {
    throw new Error("the preregistered result ID requires the frozen chain count");
  }
  return result;
}

export function createManifest(config) {
  const resultDirectory = resultRoot(config);
  fs.mkdirSync(resultDirectory, { recursive: true });
  const manifestFile = path.join(resultDirectory, "manifest.json");
  const manifest = {
    schema_version: 1,
    experiment: protocol.experiment,
    experiment_id: config.experimentId,
    benchmark: protocol.benchmark,
    pipelines: protocol.pipelines,
    chains_per_pipeline: config.chains,
    versions_per_chain: protocol.versions_per_chain,
    model: protocol.model,
    reasoning: protocol.reasoning,
    maximum_repairs_per_version: protocol.maximum_repairs_per_version,
    timeout_ms_per_model_turn: protocol.model_timeout_ms,
    fresh_context_per_version: true,
    repair_context: protocol.repair_context,
    network_access: false,
    runner_git_commit: command("git", ["rev-parse", "HEAD"]).stdout.trim(),
    protocol_sha256: sha256(path.join(experimentRoot, "protocol.json")),
    requirements_sha256: sha256(path.join(experimentRoot, "requirements.json")),
    oracle_sha256: combinedHash([
      path.join(experimentRoot, "oracle/state.mjs"),
      path.join(experimentRoot, "oracle/evaluate.mjs"),
    ]),
    codex_cli: command("codex", ["--version"]).stdout.trim(),
    rustc: command("rustc", ["--version"]).stdout.trim(),
    cargo: command("cargo", ["--version"]).stdout.trim(),
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    created_at: new Date().toISOString(),
  };
  if (fs.existsSync(manifestFile)) {
    const existing = readJson(manifestFile);
    for (const field of [
      "experiment_id",
      "chains_per_pipeline",
      "model",
      "reasoning",
      "protocol_sha256",
      "requirements_sha256",
      "oracle_sha256",
    ]) {
      if (existing[field] !== manifest[field]) {
        throw new Error(`frozen experiment manifest differs at ${field}`);
      }
    }
    return existing;
  }
  writeJson(manifestFile, manifest);
  return manifest;
}

export async function initializeChains(config, manifest) {
  for (let chain = 1; chain <= config.chains; chain += 1) {
    for (const pipeline of protocol.pipelines) {
      if (!selected(config, pipeline, chain)) continue;
      const chainState = initializeChain(config, manifest, pipeline, chain);
      if (chainState.versions.length === 0) {
        const evaluation = await evaluateProject({
          workspace: chainState.workspace,
          pipeline,
          version: 1,
        });
        chainState.versions.push({
          version: 1,
          change_id: "EV-001",
          attempts: [],
          final_evaluation: evaluation,
          completed_at: new Date().toISOString(),
        });
        saveChain(config, chainState);
        snapshotWorkspace(config, chainState, 1, "control");
      }
    }
  }
}

export async function executeSchedule(config, manifest, onProgress = () => {}) {
  for (let version = 2; version <= Math.min(config.throughVersion, protocol.versions_per_chain); version += 1) {
    for (let chain = 1; chain <= config.chains; chain += 1) {
      const order = chain % 2 === 1 ? protocol.pipelines : [...protocol.pipelines].reverse();
      for (const pipeline of order) {
        if (!selected(config, pipeline, chain)) continue;
        const chainState = initializeChain(config, manifest, pipeline, chain);
        if (chainState.versions.some((entry) => entry.version === version)) continue;
        onProgress({ pipeline, chain, version, phase: "start" });
        await executeVersion(config, chainState, version, onProgress);
        onProgress({ pipeline, chain, version, phase: "complete" });
      }
    }
  }
}

function initializeChain(config, manifest, pipeline, chain) {
  const stateFile = fs.existsSync(privateChainFile(config, pipeline, chain))
    ? privateChainFile(config, pipeline, chain)
    : publicChainFile(config, pipeline, chain);
  if (fs.existsSync(stateFile)) return readJson(stateFile);
  const workspace = path.join(
    privateRoot,
    config.experimentId,
    "workspaces",
    pipeline,
    chainName(chain),
  );
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.cpSync(path.join(experimentRoot, "templates/base"), workspace, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("target"),
  });
  fs.cpSync(path.join(experimentRoot, `templates/${pipeline}`), workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "HOST-CAPABILITIES.md"), capabilityDocument(1));
  const result = {
    schema_version: 1,
    experiment: protocol.experiment,
    experiment_id: config.experimentId,
    pipeline,
    chain,
    model: manifest.model,
    reasoning: manifest.reasoning,
    workspace,
    started_at: new Date().toISOString(),
    completed_at: null,
    invalidated: false,
    invalidation_reasons: [],
    versions: [],
  };
  saveChain(config, result);
  return result;
}

async function executeVersion(config, chainState, version, onProgress) {
  const change = requirements.versions[version - 1];
  fs.writeFileSync(path.join(chainState.workspace, "CHANGE.md"), changeDocument(change));
  fs.writeFileSync(path.join(chainState.workspace, "HOST-CAPABILITIES.md"), capabilityDocument(version));
  const versionResult = {
    version,
    change_id: change.id,
    change_kind: change.kind,
    attempts: [],
    final_evaluation: null,
    completed_at: null,
  };
  let threadId = null;
  for (let attempt = 0; attempt <= protocol.maximum_repairs_per_version; attempt += 1) {
    if (attempt > 0 && !threadId) {
      chainState.invalidated = true;
      chainState.invalidation_reasons.push(`v${version}: repair could not resume the generation context`);
    }
    const prompt = attempt === 0
      ? generationPrompt(change)
      : repairPrompt(change, versionResult.attempts.at(-1).evaluation);
    const immutableBefore = immutableInputHashes(chainState.workspace);
    const invocation = config.dryRun
      ? dryInvocation()
      : await invokeCodex(config, chainState, version, attempt, prompt, threadId);
    threadId = invocation.threadId ?? threadId;
    const evaluation = await evaluateProject({
      workspace: chainState.workspace,
      pipeline: chainState.pipeline,
      version,
    });
    const commands = invocation.events
      .filter((event) => event.type === "item.completed" && event.item?.type === "command_execution")
      .map((event) => event.item.command)
      .filter(Boolean);
    const policyViolations = commandPolicyViolations(commands, chainState.workspace);
    const immutableViolations = changedImmutableInputs(chainState.workspace, immutableBefore);
    policyViolations.push(...immutableViolations);
    if (policyViolations.length > 0) {
      chainState.invalidated = true;
      chainState.invalidation_reasons.push(...policyViolations.map((reason) => `v${version}: ${reason}`));
    }
    const attemptResult = {
      attempt,
      kind: attempt === 0 ? "generation" : "repair",
      repair_attribution: attempt === 0 ? null : repairAttribution(versionResult.attempts.at(-1).evaluation, version),
      prompt_sha256: hashText(prompt),
      prompt_bytes: Buffer.byteLength(prompt),
      generation: {
        exit_code: invocation.exitCode,
        timed_out: invocation.timedOut,
        latency_ms: round(invocation.elapsedMilliseconds),
        usage: invocation.usage,
        agent_message_bytes: invocation.agentMessageBytes,
        agent_messages: invocation.agentMessages.map((value) => sanitize(value, chainState.workspace)),
        commands: commands.map((value) => sanitize(value, chainState.workspace)),
        command_policy_violations: policyViolations,
        private_raw_events: invocation.privateEvents,
        private_raw_stderr: invocation.privateStderr,
      },
      evaluation,
      full_success: fullSuccess(evaluation) && policyViolations.length === 0,
    };
    versionResult.attempts.push(attemptResult);
    versionResult.final_evaluation = evaluation;
    snapshotWorkspace(config, chainState, version, `attempt-${attempt}`);
    saveInProgressVersion(config, chainState, versionResult);
    onProgress({
      pipeline: chainState.pipeline,
      chain: chainState.chain,
      version,
      phase: "attempt",
      attempt,
      fullSuccess: attemptResult.full_success,
      retained: evaluation.retained_intent.rate,
    });
    if (attemptResult.full_success) break;
  }
  versionResult.completed_at = new Date().toISOString();
  chainState.versions = chainState.versions.filter((entry) => entry.version !== version);
  chainState.versions.push(versionResult);
  chainState.versions.sort((left, right) => left.version - right.version);
  if (version === protocol.versions_per_chain) chainState.completed_at = new Date().toISOString();
  saveChain(config, chainState);
}

function immutableInputHashes(workspace) {
  return Object.fromEntries(["PROJECT.md", "CHANGE.md", "HOST-CAPABILITIES.md"].map((name) => {
    const file = path.join(workspace, name);
    return [name, fs.existsSync(file) ? sha256(file) : null];
  }));
}

function changedImmutableInputs(workspace, before) {
  return Object.entries(before).flatMap(([name, digest]) => {
    const file = path.join(workspace, name);
    const current = fs.existsSync(file) ? sha256(file) : null;
    return current === digest ? [] : [`modified immutable experiment input ${name}`];
  });
}

async function invokeCodex(config, chainState, version, attempt, prompt, threadId) {
  const rawDirectory = path.join(
    privateRoot,
    config.experimentId,
    "raw",
    chainState.pipeline,
    chainName(chainState.chain),
    `version-${String(version).padStart(2, "0")}`,
  );
  fs.mkdirSync(rawDirectory, { recursive: true });
  const eventsFile = path.join(rawDirectory, `attempt-${attempt}.jsonl`);
  const stderrFile = path.join(rawDirectory, `attempt-${attempt}.stderr.txt`);
  const lastMessageFile = path.join(rawDirectory, `attempt-${attempt}.last-message.txt`);
  const common = [
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    lastMessageFile,
    "--model",
    protocol.model,
    "--config",
    `model_reasoning_effort=\"${protocol.reasoning}\"`,
    "--config",
    'sandbox_mode="workspace-write"',
    "--config",
    "sandbox_workspace_write.network_access=false",
  ];
  const args = threadId
    ? ["exec", "resume", ...common, threadId, "-"]
    : ["exec", ...common, "--sandbox", "workspace-write", "--cd", chainState.workspace, "-"];
  const result = await spawnCapture("codex", args, {
    cwd: chainState.workspace,
    input: prompt,
    timeoutMilliseconds: protocol.model_timeout_ms,
  });
  fs.writeFileSync(eventsFile, result.stdout);
  fs.writeFileSync(stderrFile, result.stderr);
  const events = parseEvents(result.stdout);
  const completion = [...events].reverse().find((event) => event.type === "turn.completed");
  const started = events.find((event) => event.type === "thread.started");
  const messages = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text ?? "");
  return {
    ...result,
    events,
    threadId: started?.thread_id ?? threadId,
    usage: normalizeUsage(completion?.usage),
    agentMessageBytes: Buffer.byteLength(messages.join("\n")),
    agentMessages: messages,
    privateEvents: path.relative(repositoryRoot, eventsFile),
    privateStderr: path.relative(repositoryRoot, stderrFile),
  };
}

function generationPrompt(change) {
  return `${[
    "Implement the current change described in CHANGE.md.",
    "Treat PROJECT.md and the existing project as the full prior state.",
    "Preserve every behavior, restriction, and artifact not explicitly changed.",
    "You may inspect, edit, build, and test only this project.",
    "Do not inspect parent directories, hidden evaluator files, future changes, or the network.",
    "Do not add dependencies.",
    "Complete the implementation and its project-owned artifacts, then stop.",
    "",
    `Change ${change.id}: ${change.title}`,
    change.change_prompt,
  ].join("\n")}\n`;
}

function repairPrompt(change, evaluation) {
  const failed = evaluation.retained_intent.requirements.filter((item) => !item.passed);
  const obsolete = evaluation.obsolete_behavior.checks.filter((item) => !item.passed);
  const artifacts = evaluation.artifact_consistency.checks.filter((item) => !item.passed);
  return `${[
    "The independent evaluator rejected the current version.",
    `Repair change ${change.id} without removing or weakening other requirements.`,
    "Use only the diagnostics below and files in this project.",
    "Do not inspect parent directories, hidden evaluator files, future changes, or the network.",
    "Do not add dependencies or hardcode evaluator cases.",
    "",
    `Build success: ${evaluation.build.success}`,
    `Runtime success: ${evaluation.runtime.started}`,
    `Retained intent: ${evaluation.retained_intent.passed}/${evaluation.retained_intent.total}`,
    ...failed.map((item) => `Requirement ${item.id}: ${item.diagnostic ?? "failed"}`),
    ...obsolete.map((item) => `Obsolete behavior ${item.id}: ${item.diagnostic ?? "remains"}`),
    `Capability exact: ${evaluation.capability.exact}`,
    ...evaluation.capability.extra_actual.map((item) => `Extra compiled capability: ${item.module}.${item.name}`),
    ...evaluation.capability.missing_actual.map((item) => `Missing compiled capability: ${item.module}.${item.name}`),
    ...evaluation.capability.extra_project_policy.map((item) => `Extra project capability: ${item.module}.${item.name}`),
    ...evaluation.capability.missing_project_policy.map((item) => `Missing project capability: ${item.module}.${item.name}`),
    ...artifacts.map((item) => `Artifact ${item.id}: ${item.diagnostic ?? "inconsistent"}`),
    evaluation.build.diagnostic ? `Build diagnostic: ${truncate(evaluation.build.diagnostic, 6000)}` : "",
    "",
    "Repair the project now, then stop.",
  ].filter(Boolean).join("\n")}\n`;
}

function changeDocument(change) {
  return `${[
    `# Change ${change.id}`,
    "",
    `## ${change.title}`,
    "",
    change.change_prompt,
    "",
    "This is the only new change for this version.",
    "Future changes are intentionally unavailable.",
  ].join("\n")}\n`;
}

function capabilityDocument(version) {
  const descriptions = {
    "users.insert": "Input {name,email,verified?,status?}. Returns {ok:true,id} or {ok:false,error:duplicate_email}.",
    "users.get": "Input {id}. Returns {ok:true,user} including internal storage fields, or {ok:false,error:not_found}. The guest must filter public output.",
    "users.update_name": "Input {id,name}. Returns {ok:true} or {ok:false,error:not_found}.",
    "users.update_email": "Input {id,email}. Returns {ok:true}, duplicate_email, or not_found.",
    "audit.append_email_change": "Input {user_id,old_email,new_email}. Returns {ok:true}.",
    "users.soft_delete": "Input {id}. Returns {ok:true} or {ok:false,error:not_found}.",
    "users.update_status": "Input {id,status,reason?}. Returns {ok:true} or {ok:false,error:not_found}.",
    "profiles.upsert": "Input {user_id,timezone}. Returns {ok:true,timezone}.",
  };
  const state = stateAt(version);
  const entries = state.allowed_imports.flatMap((capability) => [
    `### ${capability.id}`,
    "",
    `Import \`${capability.module}.${capability.name}\` with the existing four-i32 JSON operation ABI.`,
    descriptions[capability.id],
    "",
  ]);
  return `${[
    "# Currently granted host capabilities",
    "",
    "This file describes the complete host capability surface available in the current version.",
    "An omitted or removed capability must not be declared, imported, or simulated through ambient WASI authority.",
    "Every listed function uses `(input_pointer, input_length, output_pointer, output_capacity) -> output_length` and exchanges UTF-8 JSON.",
    "",
    ...entries,
  ].join("\n")}\n`;
}

function fullSuccess(evaluation) {
  return evaluation.build.success
    && evaluation.runtime.started
    && evaluation.retained_intent.passed === evaluation.retained_intent.total
    && evaluation.obsolete_behavior.failures === 0
    && evaluation.capability.exact
    && evaluation.capability.revocation_failures.length === 0
    && evaluation.capability.successful_undeclared_accesses === 0
    && evaluation.artifact_consistency.passed === evaluation.artifact_consistency.total;
}

function repairAttribution(evaluation, version) {
  const state = stateAt(version);
  const failed = evaluation.retained_intent.requirements.filter((item) => !item.passed);
  const historical = failed.filter((item) => state.introduced_at[item.id] < version).map((item) => item.id);
  const current = failed.filter((item) => state.introduced_at[item.id] === version).map((item) => item.id);
  return { historical_requirements: historical, current_requirements: current };
}

function commandPolicyViolations(commands, workspace) {
  const violations = [];
  for (const value of commands) {
    if (/\bcurl\b|\bwget\b|https?:\/\//i.test(value)) violations.push("attempted network command");
    if (/\.\.\//.test(value)) violations.push("attempted parent-directory access");
    if (/longitudinal-drift\/oracle|requirements\.json|protocol\.json/.test(value)) {
      violations.push("attempted independent-protocol access");
    }
    const userPaths = value.match(/\/Users\/[^\s'\"]+/g) ?? [];
    if (userPaths.some((candidate) => !candidate.startsWith(workspace))) {
      violations.push("attempted access outside the isolated workspace");
    }
  }
  return [...new Set(violations)];
}

function saveInProgressVersion(config, chainState, versionResult) {
  const copy = structuredClone(chainState);
  copy.versions = copy.versions.filter((entry) => entry.version !== versionResult.version);
  copy.versions.push(versionResult);
  copy.versions.sort((left, right) => left.version - right.version);
  saveChain(config, copy);
}

function saveChain(config, chainState) {
  const publicValue = structuredClone(chainState);
  publicValue.workspace = "private isolated workspace";
  for (const version of publicValue.versions) {
    for (const attempt of version.attempts) {
      attempt.generation.private_raw_events = "retained locally outside the public repository";
      attempt.generation.private_raw_stderr = "retained locally outside the public repository";
    }
  }
  writeJson(publicChainFile(config, chainState.pipeline, chainState.chain), publicValue);
  writeJson(privateChainFile(config, chainState.pipeline, chainState.chain), chainState);
}

function snapshotWorkspace(config, chainState, version, label) {
  const destination = path.join(
    resultRoot(config),
    "snapshots",
    chainState.pipeline,
    chainName(chainState.chain),
    `version-${String(version).padStart(2, "0")}-${label}`,
  );
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(chainState.workspace, destination, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("target") && !source.split(path.sep).includes(".git"),
  });
}

function selected(config, pipeline, chain) {
  return !config.only || config.only === `${pipeline}:${chain}`;
}

function privateChainFile(config, pipeline, chain) {
  return path.join(
    privateRoot,
    config.experimentId,
    "state",
    pipeline,
    `${chainName(chain)}.json`,
  );
}

function publicChainFile(config, pipeline, chain) {
  return path.join(resultRoot(config), "chains", pipeline, `${chainName(chain)}.json`);
}

export function resultRoot(config) {
  return path.join(publicRoot, config.experimentId);
}

function chainName(chain) {
  return `chain-${String(chain).padStart(2, "0")}`;
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? null,
    cached_input_tokens: usage.cached_input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    reasoning_output_tokens: usage.reasoning_output_tokens ?? null,
    total_tokens: Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
      ? usage.input_tokens + usage.output_tokens
      : null,
  };
}

function dryInvocation() {
  return {
    stdout: "",
    stderr: "dry run",
    exitCode: 0,
    signal: null,
    timedOut: false,
    elapsedMilliseconds: 0,
    events: [],
    threadId: null,
    usage: null,
    agentMessageBytes: 0,
    agentMessages: [],
    privateEvents: null,
    privateStderr: null,
  };
}

function parseEvents(stdout) {
  return stdout.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { type: "unparseable" };
    }
  });
}

function spawnCapture(executable, args, options) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(options.input);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMilliseconds);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        elapsedMilliseconds: performance.now() - started,
      });
    });
  });
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const key = arguments_[index];
    if (key === "--dry-run") values.set(key, true);
    else {
      if (!key.startsWith("--") || !arguments_[index + 1]) throw new Error(`invalid argument ${key}`);
      values.set(key, arguments_[index + 1]);
      index += 1;
    }
  }
  return values;
}

function integer(value, name, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${name} must be at least ${minimum}`);
  return parsed;
}

function command(executable, args) {
  const result = spawnSync(executable, args, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function combinedHash(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function hashText(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitize(value, workspace) {
  return value.replaceAll(workspace, "<workspace>").replaceAll(repositoryRoot, "<repository>");
}

function truncate(value, maximum) {
  return value.length > maximum ? `${value.slice(0, maximum)}\n[truncated]` : value;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
