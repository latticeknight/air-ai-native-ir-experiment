import fs from "node:fs";
import path from "node:path";
import {
  experimentConfiguration,
  experimentResultRoot,
  root,
  writeJson,
} from "./lib.mjs";

const configuration = experimentConfiguration(process.argv.slice(2));
const resultRoot = experimentResultRoot(configuration);
const manifest = readJson(path.join(resultRoot, "manifest.json"));
const runs = Object.fromEntries(
  configuration.targets.map((target) => [target, readRuns(path.join(resultRoot, target))]),
);
const summaries = Object.fromEntries(
  Object.entries(runs).map(([target, values]) => [target, summarizeTarget(target, values)]),
);
const decisions = decide(summaries.air, summaries["rust-wasm"], manifest);
const summary = {
  schema_version: 1,
  experiment_id: configuration.experimentId,
  benchmark: "001-post-users",
  generated_at: new Date().toISOString(),
  manifest: path.relative(root, path.join(resultRoot, "manifest.json")),
  targets: summaries,
  decisions,
};
writeJson(path.join(resultRoot, "summary.json"), summary);

const reportFile = path.join(root, `reports/001-ai-generation-${configuration.experimentId}.md`);
fs.writeFileSync(reportFile, renderReport(summary, manifest));
process.stdout.write(`${reportFile}\n`);

function summarizeTarget(target, values) {
  const completed = values.filter((value) => value.status === "completed");
  const first = completed.map((value) => value.first_pass);
  const successful = completed.filter((value) => value.final?.full_success);
  const allAttempts = completed.flatMap((value) => value.attempts);
  const usageAttempts = allAttempts.filter((attempt) => attempt.codex.usage?.total_tokens !== null);
  const metric = (field) => proportion(first.filter((value) => value?.[field]).length, completed.length);
  const repairs = completed.map((value) => value.repair_iterations);
  const firstCategories = categoryCounts(
    completed.map((value) => value.first_pass?.failure_category).filter(Boolean),
  );
  const allCategories = categoryCounts(
    allAttempts
      .filter((attempt) => !attempt.evaluation.full_success)
      .map((attempt) => attempt.evaluation.failure.primary_category)
      .filter(Boolean),
  );
  const tokenTotals = {
    input: sum(usageAttempts.map((attempt) => attempt.codex.usage.input_tokens ?? 0)),
    cached_input: sum(usageAttempts.map((attempt) => attempt.codex.usage.cached_input_tokens ?? 0)),
    output: sum(usageAttempts.map((attempt) => attempt.codex.usage.output_tokens ?? 0)),
    reasoning_output: sum(
      usageAttempts.map((attempt) => attempt.codex.usage.reasoning_output_tokens ?? 0),
    ),
    total: sum(usageAttempts.map((attempt) => attempt.codex.usage.total_tokens ?? 0)),
  };
  const tokenRunsComplete = usageAttempts.length === allAttempts.length;
  const successfulFinalAttempts = successful.map((value) => value.attempts.at(-1));
  const artifactBytes = successfulFinalAttempts
    .map((attempt) => attempt.evaluation.artifact?.bytes)
    .filter(Number.isFinite);
  const sourceBytes = successfulFinalAttempts.map(
    (attempt) => attempt.evaluation.representation.source_bytes,
  );
  const unauthorizedAccesses = allAttempts.reduce(
    (total, attempt) =>
      total + (attempt.evaluation.security.undeclared_access_successes ?? 0),
    0,
  );
  const securityEvaluations = allAttempts.filter(
    (attempt) => attempt.evaluation.security.undeclared_access_successes !== null,
  ).length;
  return {
    target,
    raw_run_count: values.length,
    completed_run_count: completed.length,
    expected_run_count: manifest.runs_per_target,
    first_pass: {
      parse: metric("parse_success"),
      compile: metric("compile_success"),
      runtime_startup: metric("runtime_startup_success"),
      full_success: metric("full_success"),
      incorrect_but_compiling: proportion(
        first.filter((value) => value?.incorrect_but_compiling).length,
        completed.length,
      ),
    },
    eventual: {
      full_success: proportion(successful.length, completed.length),
      unrecoverable_failure: proportion(completed.length - successful.length, completed.length),
    },
    repairs: {
      mean: mean(repairs),
      median: median(repairs),
      distribution: countValues(repairs),
      regressions_introduced: sum(completed.map((value) => value.regressions_introduced)),
    },
    failures: {
      first_pass_categories: firstCategories,
      all_failed_attempt_categories: allCategories,
    },
    usage: {
      exact_turn_usage_complete: tokenRunsComplete,
      attempts_with_usage: usageAttempts.length,
      logical_model_turns: sum(allAttempts.map((attempt) => attempt.codex.logical_model_turns)),
      internal_model_calls: null,
      totals: tokenTotals,
      tokens_per_successful_output:
        tokenRunsComplete && successful.length > 0
          ? round(tokenTotals.total / successful.length)
          : null,
      output_tokens_per_successful_output:
        tokenRunsComplete && successful.length > 0
          ? round(tokenTotals.output / successful.length)
          : null,
      wall_clock_generation_ms: sum(allAttempts.map((attempt) => attempt.codex.latency_ms)),
      wall_clock_ms_per_successful_output:
        successful.length > 0
          ? round(
              sum(allAttempts.map((attempt) => attempt.codex.latency_ms)) / successful.length,
            )
          : null,
      currency_cost: null,
      currency_cost_unavailable_reason:
        "The selected Codex model has no experiment-pinned public per-token price in this harness.",
    },
    representation: {
      successful_artifact_bytes: distribution(artifactBytes),
      successful_source_bytes: distribution(sourceBytes),
      direct_dependencies: 0,
      transitive_dependencies: 0,
      dependency_graph_depth: 0,
      build_steps: 1,
    },
    safety: {
      attempts_with_security_evaluation: securityEvaluations,
      successful_undeclared_accesses: unauthorizedAccesses,
      effective_guest_imports: 1,
      earlier_static_rejection:
        target === "air"
          ? "AIR source probes were rejected by AIR verification before runtime."
          : "Generated Rust source was constrained at the shared runtime import boundary.",
    },
  };
}

function decide(air, rust, manifest) {
  const complete =
    air.completed_run_count === manifest.runs_per_target &&
    rust.completed_run_count === manifest.runs_per_target;
  if (!complete) {
    return {
      reliability: "INCONCLUSIVE",
      repairability: "INCONCLUSIVE",
      generation_efficiency: "INCONCLUSIVE",
      safety: "INCONCLUSIVE",
      simplicity: "INCONCLUSIVE",
      overall: "INCONCLUSIVE",
      recommendation: "CHANGE DIRECTION",
      reason: "The required paired sample is incomplete.",
      thresholds: decisionThresholds(),
    };
  }

  const reliability = rateDecision(
    air.first_pass.full_success.rate,
    rust.first_pass.full_success.rate,
  );
  const repairability = lowerDecision(air.repairs.mean, rust.repairs.mean, 0.5, 0.25);
  const generationEfficiency =
    air.usage.tokens_per_successful_output === null ||
    rust.usage.tokens_per_successful_output === null
      ? "UNMEASURABLE"
      : ratioDecision(
          air.usage.tokens_per_successful_output,
          rust.usage.tokens_per_successful_output,
          0.2,
          0.1,
        );
  const safety = safetyDecision(air, rust);
  const simplicity = simplicityDecision(air, rust);

  const primaryAirWins = [reliability, repairability, generationEfficiency].filter(
    (value) => value === "AIR",
  ).length;
  const primaryRustWins = [reliability, repairability, generationEfficiency].filter(
    (value) => value === "RUST",
  ).length;
  let overall;
  let recommendation;
  let reason;
  if (primaryRustWins > 0 && primaryAirWins === 0) {
    overall = "NOT PROMISING";
    recommendation = "STOP";
    reason =
      "Rust matched or beat AIR on the primary AI-generation metrics, so the additional language and compiler layer lacks experimental justification.";
  } else if (primaryAirWins >= 1 && primaryRustWins === 0) {
    overall = "PROMISING";
    recommendation = "CONTINUE AIR";
    reason =
      "AIR showed a material advantage on at least one primary AI-generation metric without losing another primary metric.";
  } else if (
    [reliability, repairability, generationEfficiency].every((value) =>
      ["TIE", "UNMEASURABLE"].includes(value),
    )
  ) {
    overall = "NOT PROMISING";
    recommendation = "STOP";
    reason =
      "AIR did not show a material AI-generation advantage; smaller representation or earlier verification alone does not justify the additional language and compiler layer.";
  } else {
    overall = "INCONCLUSIVE";
    recommendation = "CHANGE DIRECTION";
    reason = "The primary metrics point in conflicting or statistically unresolved directions.";
  }
  return {
    reliability,
    repairability,
    generation_efficiency: generationEfficiency,
    safety,
    simplicity,
    overall,
    recommendation,
    reason,
    thresholds: decisionThresholds(),
  };
}

function decisionThresholds() {
  return {
    reliability_material_rate_difference: 0.15,
    reliability_tie_band: 0.1,
    repairability_material_mean_difference: 0.5,
    repairability_tie_band: 0.25,
    efficiency_material_relative_difference: 0.2,
    efficiency_tie_band: 0.1,
    simplicity_material_relative_difference: 0.2,
  };
}

function rateDecision(air, rust) {
  const difference = air - rust;
  if (difference >= 0.15) return "AIR";
  if (difference <= -0.15) return "RUST";
  if (Math.abs(difference) <= 0.1) return "TIE";
  return "INCONCLUSIVE";
}

function lowerDecision(air, rust, material, tie) {
  const difference = rust - air;
  if (difference >= material) return "AIR";
  if (difference <= -material) return "RUST";
  if (Math.abs(difference) <= tie) return "TIE";
  return "INCONCLUSIVE";
}

function ratioDecision(air, rust, material, tie) {
  const relative = (rust - air) / rust;
  if (relative >= material) return "AIR";
  if (relative <= -material) return "RUST";
  if (Math.abs(relative) <= tie) return "TIE";
  return "INCONCLUSIVE";
}

function safetyDecision(air, rust) {
  if (
    air.safety.successful_undeclared_accesses === 0 &&
    rust.safety.successful_undeclared_accesses === 0
  ) {
    return "TIE";
  }
  if (
    air.safety.successful_undeclared_accesses < rust.safety.successful_undeclared_accesses
  ) {
    return "AIR";
  }
  if (
    rust.safety.successful_undeclared_accesses < air.safety.successful_undeclared_accesses
  ) {
    return "RUST";
  }
  return "INCONCLUSIVE";
}

function simplicityDecision(air, rust) {
  const airBytes = air.representation.successful_source_bytes.median;
  const rustBytes = rust.representation.successful_source_bytes.median;
  if (!Number.isFinite(airBytes) || !Number.isFinite(rustBytes)) return "INCONCLUSIVE";
  return ratioDecision(airBytes, rustBytes, 0.2, 0.1);
}

function renderReport(summary, manifest) {
  const air = summary.targets.air;
  const rust = summary.targets["rust-wasm"];
  const decision = summary.decisions;
  return `# AIR vs Rust/Wasm: Benchmark 001 AI-generation experiment

## Final conclusion

Reliability: **${decision.reliability}**
Repairability: **${decision.repairability}**
Generation efficiency: **${decision.generation_efficiency}**
Safety: **${decision.safety}**
Simplicity: **${decision.simplicity}**

Overall: **${decision.overall}**

Reason: ${decision.reason}

Recommendation: **${decision.recommendation}**

## Controlled conditions

Both targets used \`${manifest.model}\` with \`${manifest.reasoning}\` reasoning through \`${manifest.codex_cli}\`.
Each run began in a fresh isolated workspace and each repair resumed only its own thread.
User configuration and project execution rules were ignored.
Both targets had the same workspace-write sandbox, tools, timeout, natural-language specification, neutral guest ABI, maximum three-repair policy, and alternating paired order.
The CLI supplied exact aggregate per-turn token telemetry.
The CLI did not expose a seed, per-turn maximum output-token control, or internal inference-call count, and those fields remain unavailable.
The AIR target guide was ${manifest.prompt_bytes.air} bytes and the Rust target guide was ${manifest.prompt_bytes["rust-wasm"]} bytes.
That intrinsic new-language documentation asymmetry is included in input-token usage and discussed under limitations.

## Reliability

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Completed runs | ${air.completed_run_count}/${air.expected_run_count} | ${rust.completed_run_count}/${rust.expected_run_count} |
| First-pass parse | ${rate(air.first_pass.parse)} | ${rate(rust.first_pass.parse)} |
| First-pass compile | ${rate(air.first_pass.compile)} | ${rate(rust.first_pass.compile)} |
| First-pass runtime startup | ${rate(air.first_pass.runtime_startup)} | ${rate(rust.first_pass.runtime_startup)} |
| First-pass fully correct | ${rate(air.first_pass.full_success)} | ${rate(rust.first_pass.full_success)} |
| Eventual fully correct | ${rate(air.eventual.full_success)} | ${rate(rust.eventual.full_success)} |
| Incorrect but compiling on first pass | ${rate(air.first_pass.incorrect_but_compiling)} | ${rate(rust.first_pass.incorrect_but_compiling)} |
| Unrecoverable after repairs | ${rate(air.eventual.unrecoverable_failure)} | ${rate(rust.eventual.unrecoverable_failure)} |

The intervals are 95 percent Wilson score intervals.
The predeclared material reliability threshold is a 15 percentage-point difference, with differences up to 10 points classified as a tie.

## Repairability

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Mean repair iterations | ${format(air.repairs.mean)} | ${format(rust.repairs.mean)} |
| Median repair iterations | ${format(air.repairs.median)} | ${format(rust.repairs.median)} |
| Repair distribution | ${formatCounts(air.repairs.distribution)} | ${formatCounts(rust.repairs.distribution)} |
| Regressions introduced | ${air.repairs.regressions_introduced} | ${rust.repairs.regressions_introduced} |

## Generation efficiency

| Metric | AIR | Rust/Wasm |
|---|---:|---:|
| Logical Codex turns | ${air.usage.logical_model_turns} | ${rust.usage.logical_model_turns} |
| Total input tokens | ${air.usage.totals.input} | ${rust.usage.totals.input} |
| Cached input tokens | ${air.usage.totals.cached_input} | ${rust.usage.totals.cached_input} |
| Total output tokens | ${air.usage.totals.output} | ${rust.usage.totals.output} |
| Reasoning output tokens | ${air.usage.totals.reasoning_output} | ${rust.usage.totals.reasoning_output} |
| Total reported tokens | ${air.usage.totals.total} | ${rust.usage.totals.total} |
| Tokens per fully correct output | ${format(air.usage.tokens_per_successful_output)} | ${format(rust.usage.tokens_per_successful_output)} |
| Wall time per fully correct output | ${format(air.usage.wall_clock_ms_per_successful_output)} ms | ${format(rust.usage.wall_clock_ms_per_successful_output)} ms |

Currency cost is unavailable because the experiment does not pin a public price for the selected Codex model.
The primary cost metric therefore uses exact reported tokens per fully correct output.

## Failure taxonomy

### First-pass failures

| Category | AIR | Rust/Wasm |
|---|---:|---:|
${failureRows(air.failures.first_pass_categories, rust.failures.first_pass_categories)}

### All failed attempts

| Category | AIR | Rust/Wasm |
|---|---:|---:|
${failureRows(air.failures.all_failed_attempt_categories, rust.failures.all_failed_attempt_categories)}

## Safety

AIR successful undeclared accesses: **${air.safety.successful_undeclared_accesses}**.
Rust/Wasm successful undeclared accesses: **${rust.safety.successful_undeclared_accesses}**.
AIR retains earlier verifier rejection for mutated AIR source.
Both deployed targets still depend on the same single-import Wasmtime boundary for effective runtime isolation.

## Representation and build complexity

| Metric for successful final candidates | AIR | Rust/Wasm |
|---|---:|---:|
| Median source bytes | ${format(air.representation.successful_source_bytes.median)} | ${format(rust.representation.successful_source_bytes.median)} |
| Mean source bytes | ${format(air.representation.successful_source_bytes.mean)} | ${format(rust.representation.successful_source_bytes.mean)} |
| Median Wasm bytes | ${format(air.representation.successful_artifact_bytes.median)} | ${format(rust.representation.successful_artifact_bytes.median)} |
| Direct dependencies | ${air.representation.direct_dependencies} | ${rust.representation.direct_dependencies} |
| Transitive dependencies | ${air.representation.transitive_dependencies} | ${rust.representation.transitive_dependencies} |
| Build steps | ${air.representation.build_steps} | ${rust.representation.build_steps} |

## Critical falsification question

If Rust/Wasm is generated just as reliably and cheaply as AIR, AIR does not justify a new language and compiler layer in its current form.
The smaller AIR artifacts and earlier capability verification are useful properties, but they are not sufficient alone when the same deployed authority boundary is reproduced by Rust plus Wasmtime.
The overall decision above applies that kill criterion directly.

## Experimental limitations

- AIR 0.1 is specialised to this exact benchmark and its target guide necessarily describes the verifier's narrow accepted structure.
- Rust relies on the model's pretrained Rust knowledge, while AIR requires an explicit grammar and capability digest guide.
- This asymmetry is intrinsic to testing a new language, but it favours AIR on a benchmark its compiler already encodes and limits generalisation.
- Codex agent turns may contain multiple internal inference calls around file tools, but the CLI exposes only aggregate turn usage.
- No sampling seed or explicit output-token maximum was available in the installed CLI.
- Currency cost is unavailable, so exact token usage is the cost proxy.
- The sample covers one model, one reasoning setting, one machine, and only Benchmark 001.
- Hidden tests are black-box HTTP cases, while the neutral ABI necessarily discloses return codes and the permitted import.
- Generated Rust is constrained to zero third-party dependencies to prevent build-script execution and network or cache asymmetry.

## Evidence locations

The experiment manifest is \`${summary.manifest}\`.
Every run, attempt, diagnostic, candidate snapshot, raw Codex JSONL stream, functional result, and security result is retained below \`${path.relative(root, resultRoot)}/\`.

The automation uses Codex's documented [non-interactive JSONL mode](https://developers.openai.com/codex/noninteractive), including per-turn usage metadata and resumable threads.
`;
}

function proportion(successes, total) {
  const rateValue = total === 0 ? null : successes / total;
  const interval = total === 0 ? [null, null] : wilson(successes, total);
  return {
    successes,
    total,
    rate: rateValue === null ? null : round(rateValue),
    confidence_interval_95: interval.map((value) => (value === null ? null : round(value))),
  };
}

function wilson(successes, total) {
  const z = 1.959963984540054;
  const rateValue = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (rateValue + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((rateValue * (1 - rateValue)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

function categoryCounts(categories) {
  return Object.fromEntries(
    [...new Set(categories)].sort().map((category) => [
      category,
      categories.filter((value) => value === category).length,
    ]),
  );
}

function countValues(values) {
  return Object.fromEntries(
    [...new Set(values)].sort((left, right) => left - right).map((value) => [
      String(value),
      values.filter((candidate) => candidate === value).length,
    ]),
  );
}

function distribution(values) {
  return {
    count: values.length,
    mean: mean(values),
    median: median(values),
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    samples: values,
  };
}

function failureRows(air, rust) {
  const categories = [...new Set([...Object.keys(air), ...Object.keys(rust)])].sort();
  if (categories.length === 0) return "| none | 0 | 0 |";
  return categories.map((category) => `| ${category} | ${air[category] ?? 0} | ${rust[category] ?? 0} |`).join("\n");
}

function rate(value) {
  if (value.rate === null) return "unavailable";
  const [low, high] = value.confidence_interval_95;
  return `${value.successes}/${value.total} = ${Math.round(value.rate * 100)}% (${Math.round(low * 100)}%-${Math.round(high * 100)}%)`;
}

function formatCounts(value) {
  return Object.entries(value).map(([repairs, count]) => `${repairs}: ${count}`).join(", ") || "none";
}

function format(value) {
  return Number.isFinite(value) ? String(round(value)) : "unavailable";
}

function readRuns(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((file) => /^run-\d+\.json$/.test(file))
    .sort()
    .map((file) => readJson(path.join(directory, file)));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length ? round(sum(values) / values.length) : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
