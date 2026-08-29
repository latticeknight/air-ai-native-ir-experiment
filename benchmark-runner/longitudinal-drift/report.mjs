#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { configuration, resultRoot } from "./lib.mjs";
import { protocol, stateAt } from "../../experiments/longitudinal-drift/oracle/state.mjs";

const config = configuration(process.argv.slice(2));
const root = resultRoot(config);
const chains = loadChains(root);
const metrics = chains.map(chainMetrics);
const valid = metrics.filter((chain) => !chain.invalidated && chain.complete);
const groups = Object.fromEntries(
  protocol.pipelines.map((pipeline) => [pipeline, valid.filter((chain) => chain.pipeline === pipeline)]),
);
const paired = pairedChains(groups.baseline, groups.air);
const comparison = compare(paired);
const decision = decide(groups, paired, comparison);
const dimensions = dimensionOutcomes(groups, paired, comparison);
const summary = {
  schema_version: 1,
  experiment: protocol.experiment,
  experiment_id: config.experimentId,
  generated_at: new Date().toISOString(),
  chains_found: chains.length,
  valid_complete_chains: Object.fromEntries(
    protocol.pipelines.map((pipeline) => [pipeline, groups[pipeline].length]),
  ),
  chain_metrics: metrics,
  aggregates: Object.fromEntries(
    protocol.pipelines.map((pipeline) => [pipeline, aggregate(groups[pipeline])]),
  ),
  paired_comparison: comparison,
  dimension_outcomes: dimensions,
  conclusion: decision,
};

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(root, "report.md"), markdown(summary));
process.stdout.write(`${JSON.stringify(decision)}\n`);

function chainMetrics(chain) {
  const versions = chain.versions.filter((entry) => entry.final_evaluation);
  const rates = versions.map((entry) => entry.final_evaluation.retained_intent.rate);
  const historicalRegressions = regressionEvents(versions);
  const obsoleteEvents = onsetEvents(
    versions,
    (entry) => entry.final_evaluation.obsolete_behavior.checks
      .filter((item) => !item.passed)
      .map((item) => item.id),
  );
  const capabilityEvents = onsetEvents(versions, (entry) => {
    const capability = entry.final_evaluation.capability;
    return [
      ...capability.extra_actual.map((item) => `compiled:${item.module}.${item.name}`),
      ...capability.extra_project_policy.map((item) => `policy:${item.module}.${item.name}`),
      ...capability.revocation_failures.map((id) => `revoked:${id}`),
    ];
  });
  const attempts = versions.flatMap((entry) => entry.attempts);
  const repairs = attempts.filter((attempt) => attempt.kind === "repair");
  const historicalRepairs = repairs.filter(
    (attempt) => (attempt.repair_attribution?.historical_requirements.length ?? 0) > 0,
  );
  const tokens = attempts.map((attempt) => attempt.generation.usage?.total_tokens).filter(Number.isFinite);
  const successfulChanges = versions.filter(
    (entry) => entry.version > 1 && entry.attempts.at(-1)?.full_success,
  ).length;
  const final = versions.find((entry) => entry.version === protocol.versions_per_chain)?.final_evaluation ?? null;
  return {
    pipeline: chain.pipeline,
    chain: chain.chain,
    invalidated: chain.invalidated,
    invalidation_reasons: chain.invalidation_reasons,
    complete: Boolean(chain.completed_at) && versions.length === protocol.versions_per_chain,
    versions_completed: versions.length,
    retained_intent_auc: mean(rates),
    final_retained_intent: final?.retained_intent.rate ?? null,
    historical_regressions: historicalRegressions.length,
    historical_regression_events: historicalRegressions,
    obsolete_behavior_events: obsoleteEvents.length,
    obsolete_events: obsoleteEvents,
    capability_drift_events: capabilityEvents.length,
    capability_events: capabilityEvents,
    artifact_consistency_mean: mean(
      versions.map((entry) => entry.final_evaluation.artifact_consistency.rate),
    ),
    artifact_consistency_final: final?.artifact_consistency.rate ?? null,
    manually_maintained_artifacts_final:
      final?.complexity.manually_maintained_authoritative_artifacts ?? null,
    repair_turns: repairs.length,
    historical_repair_turns: historicalRepairs.length,
    regressions_introduced_by_repairs: repairRegressions(versions),
    lifecycle_tokens: tokens.length === attempts.length ? sum(tokens) : null,
    historical_repair_tokens: historicalRepairs.every((attempt) => Number.isFinite(attempt.generation.usage?.total_tokens))
      ? sum(historicalRepairs.map((attempt) => attempt.generation.usage.total_tokens))
      : null,
    tokens_per_successful_change: successfulChanges > 0 && tokens.length === attempts.length
      ? sum(tokens) / successfulChanges
      : null,
    elapsed_generation_ms: sum(attempts.map((attempt) => attempt.generation.latency_ms)),
    model_turns: attempts.length,
    first_pass_successes: versions.filter(
      (entry) => entry.version > 1 && entry.attempts[0]?.full_success,
    ).length,
    versions_requiring_repair: versions.filter((entry) => entry.attempts.length > 1).length,
    wasm_bytes_final: final?.complexity.wasm_bytes ?? null,
    representation_bytes_final: final?.complexity.project_representation_bytes ?? null,
    direct_dependencies_final: final?.complexity.direct_dependencies ?? null,
    transitive_dependencies_final: final?.complexity.transitive_dependencies ?? null,
    dependency_graph_depth_final: final?.complexity.dependency_graph_depth ?? null,
    complexity_by_version: versions.map((entry) => ({
      version: entry.version,
      ...entry.final_evaluation.complexity,
      build_ms: entry.final_evaluation.build.elapsed_ms,
    })),
    successful_undeclared_accesses: sum(
      versions.map((entry) => entry.final_evaluation.capability.successful_undeclared_accesses),
    ),
  };
}

function repairRegressions(versions) {
  let count = 0;
  for (const version of versions) {
    for (let index = 1; index < version.attempts.length; index += 1) {
      const before = new Map(
        version.attempts[index - 1].evaluation.retained_intent.requirements
          .map((item) => [item.id, item.passed]),
      );
      count += version.attempts[index].evaluation.retained_intent.requirements.filter(
        (item) => before.get(item.id) === true && !item.passed,
      ).length;
    }
  }
  return count;
}

function regressionEvents(versions) {
  const previous = new Map();
  const everPassed = new Set();
  const events = [];
  for (const entry of versions) {
    const state = stateAt(entry.version);
    for (const result of entry.final_evaluation.retained_intent.requirements) {
      if (result.passed) everPassed.add(result.id);
      const wasPassing = previous.get(result.id) === true;
      const historical = state.introduced_at[result.id] < entry.version;
      if (!result.passed && wasPassing && everPassed.has(result.id) && historical) {
        events.push({ version: entry.version, requirement: result.id });
      }
      previous.set(result.id, result.passed);
    }
  }
  return events;
}

function onsetEvents(versions, identities) {
  let active = new Set();
  const events = [];
  for (const entry of versions) {
    const current = new Set(identities(entry));
    for (const id of current) {
      if (!active.has(id)) events.push({ version: entry.version, id });
    }
    active = current;
  }
  return events;
}

function pairedChains(baseline, air) {
  const airByChain = new Map(air.map((value) => [value.chain, value]));
  return baseline
    .filter((value) => airByChain.has(value.chain))
    .map((value) => ({ chain: value.chain, baseline: value, air: airByChain.get(value.chain) }));
}

function compare(pairs) {
  const definitions = {
    retained_intent_auc: { direction: "higher", threshold: protocol.thresholds.retained_intent_absolute },
    final_retained_intent: { direction: "higher", threshold: protocol.thresholds.retained_intent_absolute },
    artifact_consistency_mean: { direction: "higher", threshold: protocol.thresholds.artifact_consistency_absolute },
    historical_regressions: {
      direction: "lower",
      relative: protocol.thresholds.historical_regressions_relative_reduction,
      absolute: protocol.thresholds.historical_regressions_absolute_per_chain,
    },
    capability_drift_events: {
      direction: "lower",
      relative: protocol.thresholds.capability_drift_relative_reduction,
      absolute: protocol.thresholds.capability_drift_absolute_per_chain,
    },
    obsolete_behavior_events: {
      direction: "lower",
      relative: protocol.thresholds.obsolete_behavior_relative_reduction,
      absolute: protocol.thresholds.obsolete_behavior_absolute_per_chain,
    },
    historical_repair_turns: {
      direction: "lower",
      relative: protocol.thresholds.historical_repair_relative_reduction,
      absolute: protocol.thresholds.historical_repair_absolute_per_chain,
    },
    lifecycle_tokens: {
      direction: "lower",
      relative: protocol.thresholds.lifecycle_tokens_relative_reduction,
    },
    repair_turns: { direction: "lower" },
  };
  return Object.fromEntries(Object.entries(definitions).map(([metric, definition]) => {
    const baseline = pairs.map((pair) => pair.baseline[metric]).filter(Number.isFinite);
    const air = pairs.map((pair) => pair.air[metric]).filter(Number.isFinite);
    const pairedValues = pairs
      .filter((pair) => Number.isFinite(pair.baseline[metric]) && Number.isFinite(pair.air[metric]))
      .map((pair) => ({
        chain: pair.chain,
        baseline: pair.baseline[metric],
        air: pair.air[metric],
        air_minus_baseline: pair.air[metric] - pair.baseline[metric],
      }));
    const baselineMean = mean(baseline);
    const airMean = mean(air);
    const reduction = Number.isFinite(baselineMean) && baselineMean !== 0
      ? (baselineMean - airMean) / baselineMean
      : baselineMean === 0 && airMean === 0 ? 0 : null;
    const absoluteAdvantage = definition.direction === "higher"
      ? airMean - baselineMean
      : baselineMean - airMean;
    const material = definition.threshold !== undefined
      ? absoluteAdvantage >= definition.threshold
      : definition.relative !== undefined
        ? reduction !== null
          && reduction >= definition.relative
          && (definition.absolute === undefined || absoluteAdvantage >= definition.absolute)
        : false;
    return [metric, {
      baseline_mean: baselineMean,
      baseline_median: median(baseline),
      air_mean: airMean,
      air_median: median(air),
      absolute_air_advantage: absoluteAdvantage,
      relative_air_reduction: reduction,
      material,
      paired_values: pairedValues,
    }];
  }));
}

function decide(groups, pairs, comparison) {
  if (pairs.length < protocol.chains_per_pipeline) {
    return {
      result: "INCONCLUSIVE",
      recommendation: "CHANGE DIRECTION",
      why: `Only ${pairs.length} of ${protocol.chains_per_pipeline} preregistered paired chains completed validly.`,
      material_advantages: [],
      serious_regressions: [],
    };
  }
  const material = Object.entries(comparison)
    .filter(([name, value]) => value.material && materialQualifier(name, groups, comparison))
    .map(([name]) => name);
  const serious = [];
  for (const metric of ["retained_intent_auc", "final_retained_intent"]) {
    if (comparison[metric].absolute_air_advantage < -protocol.thresholds.serious_retained_intent_regression) {
      serious.push(metric);
    }
  }
  const baselineRepairs = comparison.repair_turns.baseline_mean;
  const airRepairs = comparison.repair_turns.air_mean;
  if (baselineRepairs === 0 ? airRepairs > 0 : (airRepairs - baselineRepairs) / baselineRepairs >= protocol.thresholds.serious_repair_increase) {
    serious.push("repair_turns");
  }
  if (groups.air.some((chain) => chain.successful_undeclared_accesses > 0)) {
    serious.push("successful_undeclared_capability_access");
  }
  const propagationFailure = groups.air.some((chain) => chain.artifact_consistency_final < 1)
    && groups.baseline.every((chain) => chain.artifact_consistency_final === 1);
  if (propagationFailure) serious.push("air_contract_propagation");
  if (material.length > 0 && serious.length === 0) {
    return {
      result: "PROMISING",
      recommendation: "CONTINUE",
      why: `AIR met preregistered material thresholds for ${material.join(", ")} without a serious regression.`,
      material_advantages: material,
      serious_regressions: serious,
    };
  }
  if (material.length > 0 && serious.length > 0) {
    return {
      result: "INCONCLUSIVE",
      recommendation: "CHANGE DIRECTION",
      why: "Material advantages and serious regressions conflict.",
      material_advantages: material,
      serious_regressions: serious,
    };
  }
  return {
    result: "NOT PROMISING",
    recommendation: "STOP",
    why: "AIR met no preregistered material longitudinal threshold.",
    material_advantages: material,
    serious_regressions: serious,
  };
}

function dimensionOutcomes(groups, pairs, comparison) {
  if (pairs.length < protocol.chains_per_pipeline) {
    return Object.fromEntries([
      "retained_intent",
      "historical_regression_resistance",
      "capability_drift_resistance",
      "obsolete_behavior_removal",
      "artifact_consistency",
      "repairability_over_lifecycle",
      "lifecycle_generation_efficiency",
      "representation_deployment_simplicity",
    ].map((name) => [name, "INCONCLUSIVE"]));
  }
  return {
    retained_intent: combinedRetainedOutcome(comparison),
    historical_regression_resistance: classifyLower(
      comparison.historical_regressions,
      protocol.thresholds.historical_regressions_relative_reduction,
      protocol.thresholds.historical_regressions_absolute_per_chain,
    ),
    capability_drift_resistance: classifyLower(
      comparison.capability_drift_events,
      protocol.thresholds.capability_drift_relative_reduction,
      protocol.thresholds.capability_drift_absolute_per_chain,
    ),
    obsolete_behavior_removal: classifyLower(
      comparison.obsolete_behavior_events,
      protocol.thresholds.obsolete_behavior_relative_reduction,
      protocol.thresholds.obsolete_behavior_absolute_per_chain,
    ),
    artifact_consistency: qualifiedAirOutcome(
      classifyHigher(
        comparison.artifact_consistency_mean.absolute_air_advantage,
        protocol.thresholds.artifact_consistency_absolute,
      ),
      materialQualifier("artifact_consistency_mean", groups, comparison),
    ),
    repairability_over_lifecycle: classifyLower(
      comparison.historical_repair_turns,
      protocol.thresholds.historical_repair_relative_reduction,
      protocol.thresholds.historical_repair_absolute_per_chain,
    ),
    lifecycle_generation_efficiency: qualifiedAirOutcome(
      classifyLower(
        comparison.lifecycle_tokens,
        protocol.thresholds.lifecycle_tokens_relative_reduction,
        0,
      ),
      materialQualifier("lifecycle_tokens", groups, comparison),
    ),
    representation_deployment_simplicity: representationOutcome(groups),
  };
}

function qualifiedAirOutcome(outcome, airQualifies) {
  return outcome === "AIR" && !airQualifies ? "TIE" : outcome;
}

function combinedRetainedOutcome(comparison) {
  const outcomes = [
    classifyHigher(
      comparison.retained_intent_auc.absolute_air_advantage,
      protocol.thresholds.retained_intent_absolute,
    ),
    classifyHigher(
      comparison.final_retained_intent.absolute_air_advantage,
      protocol.thresholds.retained_intent_absolute,
    ),
  ];
  if (outcomes.includes("AIR") && outcomes.includes("BASELINE")) return "INCONCLUSIVE";
  if (outcomes.includes("AIR")) return "AIR";
  if (outcomes.includes("BASELINE")) return "BASELINE";
  return "TIE";
}

function classifyHigher(airAdvantage, threshold) {
  if (airAdvantage >= threshold) return "AIR";
  if (airAdvantage <= -threshold) return "BASELINE";
  return "TIE";
}

function classifyLower(value, relativeThreshold, absoluteThreshold) {
  if (value.material) return "AIR";
  const baseline = value.baseline_mean;
  const air = value.air_mean;
  const baselineReduction = air === 0 ? 0 : (air - baseline) / air;
  if (baselineReduction >= relativeThreshold && air - baseline >= absoluteThreshold) return "BASELINE";
  return "TIE";
}

function representationOutcome(groups) {
  const threshold = protocol.thresholds.representation_or_wasm_relative_reduction;
  const measures = (pipeline) => ({
    representation: mean(groups[pipeline].map((chain) => chain.representation_bytes_final)),
    wasm: mean(groups[pipeline].map((chain) => chain.wasm_bytes_final)),
    direct: mean(groups[pipeline].map((chain) => chain.direct_dependencies_final)),
    depth: mean(groups[pipeline].map((chain) => chain.dependency_graph_depth_final)),
    manual: mean(groups[pipeline].map((chain) => chain.manually_maintained_artifacts_final)),
  });
  const baseline = measures("baseline");
  const air = measures("air");
  const airSmaller = (baseline.representation - air.representation) / baseline.representation >= threshold
    || (baseline.wasm - air.wasm) / baseline.wasm >= threshold;
  const baselineSmaller = (air.representation - baseline.representation) / air.representation >= threshold
    || (air.wasm - baseline.wasm) / air.wasm >= threshold;
  if (airSmaller && air.direct <= baseline.direct && air.depth <= baseline.depth && air.manual <= baseline.manual) return "AIR";
  if (baselineSmaller && baseline.direct <= air.direct && baseline.depth <= air.depth && baseline.manual <= air.manual) return "BASELINE";
  return "TIE";
}

function materialQualifier(name, groups, comparison) {
  if (name === "lifecycle_tokens") {
    return comparison.retained_intent_auc.absolute_air_advantage
        >= -protocol.thresholds.allowed_retained_intent_regression_for_token_win
      && comparison.final_retained_intent.absolute_air_advantage
        >= -protocol.thresholds.allowed_retained_intent_regression_for_token_win;
  }
  if (name === "artifact_consistency_mean") {
    return mean(groups.air.map((chain) => chain.manually_maintained_artifacts_final))
      <= mean(groups.baseline.map((chain) => chain.manually_maintained_artifacts_final));
  }
  return true;
}

function aggregate(values) {
  const metrics = [
    "retained_intent_auc",
    "final_retained_intent",
    "historical_regressions",
    "obsolete_behavior_events",
    "capability_drift_events",
    "artifact_consistency_mean",
    "repair_turns",
    "historical_repair_turns",
    "regressions_introduced_by_repairs",
    "lifecycle_tokens",
    "historical_repair_tokens",
    "tokens_per_successful_change",
    "elapsed_generation_ms",
    "first_pass_successes",
    "versions_requiring_repair",
    "wasm_bytes_final",
    "representation_bytes_final",
  ];
  return Object.fromEntries(metrics.map((metric) => {
    const observations = values.map((value) => value[metric]).filter(Number.isFinite);
    return [metric, {
      mean: mean(observations),
      median: median(observations),
      sample_standard_deviation: standardDeviation(observations),
      values: observations,
    }];
  }));
}

function markdown(summary) {
  const baseline = summary.aggregates.baseline;
  const air = summary.aggregates.air;
  const rows = [
    ["Retained intent AUC", baseline.retained_intent_auc.mean, air.retained_intent_auc.mean],
    ["Final retained intent", baseline.final_retained_intent.mean, air.final_retained_intent.mean],
    ["Historical regressions per chain", baseline.historical_regressions.mean, air.historical_regressions.mean],
    ["Capability drift events per chain", baseline.capability_drift_events.mean, air.capability_drift_events.mean],
    ["Obsolete behavior events per chain", baseline.obsolete_behavior_events.mean, air.obsolete_behavior_events.mean],
    ["Artifact consistency", baseline.artifact_consistency_mean.mean, air.artifact_consistency_mean.mean],
    ["Repair turns per chain", baseline.repair_turns.mean, air.repair_turns.mean],
    ["Historical repair turns per chain", baseline.historical_repair_turns.mean, air.historical_repair_turns.mean],
    ["Lifecycle tokens per chain", baseline.lifecycle_tokens.mean, air.lifecycle_tokens.mean],
  ];
  return `${[
    "# AIR longitudinal drift experiment report",
    "",
    "## Result",
    "",
    `**${summary.conclusion.result} - ${summary.conclusion.recommendation}**`,
    "",
    summary.conclusion.why,
    "",
    "## Required outcome matrix",
    "",
    `Retained intent: **${summary.dimension_outcomes.retained_intent}**`,
    "",
    `Historical regression resistance: **${summary.dimension_outcomes.historical_regression_resistance}**`,
    "",
    `Capability drift resistance: **${summary.dimension_outcomes.capability_drift_resistance}**`,
    "",
    `Obsolete behavior removal: **${summary.dimension_outcomes.obsolete_behavior_removal}**`,
    "",
    `Artifact consistency: **${summary.dimension_outcomes.artifact_consistency}**`,
    "",
    `Repairability over lifecycle: **${summary.dimension_outcomes.repairability_over_lifecycle}**`,
    "",
    `Lifecycle generation efficiency: **${summary.dimension_outcomes.lifecycle_generation_efficiency}**`,
    "",
    `Representation/deployment simplicity: **${summary.dimension_outcomes.representation_deployment_simplicity}**`,
    "",
    "## Aggregate comparison",
    "",
    "| Metric | Conventional baseline mean | AIR-contract mean |",
    "| --- | ---: | ---: |",
    ...rows.map(([label, conventional, airValue]) => `| ${label} | ${format(conventional)} | ${format(airValue)} |`),
    "",
    "## Sample and failures",
    "",
    `The report includes ${summary.valid_complete_chains.baseline} valid complete conventional chains and ${summary.valid_complete_chains.air} valid complete AIR-contract chains.`,
    "All invalidated, incomplete, and unsuccessful versions remain in the raw chain results and snapshots.",
    "No failed chain is removed from the public result set.",
    "",
    "## Interpretation",
    "",
    "The conclusion is calculated from the thresholds preregistered in `docs/drift-hypothesis.md`.",
    "Representation size and Wasm size are descriptive and cannot independently make AIR promising.",
    "This longitudinal result does not alter the previous implementation-language or mutation-experiment conclusions.",
    "",
    "## Falsification questions",
    "",
    `1. Long-term requirement retention: ${summary.dimension_outcomes.retained_intent}.`,
    `2. Capability drift: ${summary.dimension_outcomes.capability_drift_resistance}.`,
    `3. Stale or obsolete behavior: ${summary.dimension_outcomes.obsolete_behavior_removal}.`,
    `4. Contract, code, test, schema, and policy consistency: ${summary.dimension_outcomes.artifact_consistency}.`,
    `5. Total AI maintenance effort: ${summary.dimension_outcomes.lifecycle_generation_efficiency} for tokens and ${summary.dimension_outcomes.repairability_over_lifecycle} for repairs.`,
    `6. Lifecycle token effect: ${tokenEffect(summary.paired_comparison.lifecycle_tokens)}.`,
    `7. Evolved representation and deployment surface: ${summary.dimension_outcomes.representation_deployment_simplicity}.`,
    `8. Existing formats as a canonical source: ${existingFormatAnswer(summary)}.`,
    `9. New abstraction or consolidation: ${abstractionAnswer(summary)}.`,
    `10. Added tooling justified: ${summary.conclusion.recommendation}.`,
    "",
    "## Limitations and confounds",
    "",
    "The five-chain sample is exploratory, has no exposed sampling seed, and supports no formal significance claim.",
    "A hidden superset SQLite schema removes migration work equally from both pipelines.",
    "The AIR treatment tests canonical-contract consolidation, so any advantage may be reproducible with an existing canonical format and generators.",
    "Requirement-group weighting, correlated failures after a broken version, aggregate Codex token telemetry, and one small application limit generalisation.",
    "The complete preregistered analysis is in `experiments/longitudinal-drift/confounds.md`.",
    "",
    "## Reproduction evidence",
    "",
    "`summary.json` contains per-chain values, paired observations, means, medians, materiality decisions, invalidations, and failure identities.",
    "The `chains/` directory contains every version and repair attempt.",
    "The `snapshots/` directory contains the complete public project state after every evaluated attempt.",
  ].join("\n")}\n`;
}

function tokenEffect(value) {
  if (!Number.isFinite(value.relative_air_reduction)) return "unavailable";
  const percent = Math.abs(value.relative_air_reduction * 100).toFixed(1);
  if (value.relative_air_reduction > 0) return `AIR used ${percent}% fewer reported lifecycle tokens`;
  if (value.relative_air_reduction < 0) return `AIR used ${percent}% more reported lifecycle tokens`;
  return "reported lifecycle tokens were equal";
}

function existingFormatAnswer(summary) {
  const relevant = [
    summary.dimension_outcomes.retained_intent,
    summary.dimension_outcomes.capability_drift_resistance,
    summary.dimension_outcomes.obsolete_behavior_removal,
    summary.dimension_outcomes.artifact_consistency,
  ];
  return relevant.includes("AIR")
    ? "this benchmark leaves the question open because AIR had a measured drift advantage"
    : "this benchmark found no drift advantage that requires AIR rather than a conventional canonical format";
}

function abstractionAnswer(summary) {
  return summary.conclusion.material_advantages.length > 0
    ? "the measured advantages identify the specific dimensions, but do not by themselves prove a uniquely AIR abstraction"
    : "the experiment provides no evidence beyond consolidation of existing specifications";
}

function loadChains(root) {
  const directory = path.join(root, "chains");
  if (!fs.existsSync(directory)) return [];
  return listFiles(directory).filter((file) => file.endsWith(".json")).map(readJson);
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(current) : [current];
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mean(values) {
  return values.length === 0 ? null : sum(values) / values.length;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = sum(values.map((value) => (value - average) ** 2)) / (values.length - 1);
  return Math.sqrt(variance);
}

function format(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toLocaleString("en-GB") : "unavailable";
}
