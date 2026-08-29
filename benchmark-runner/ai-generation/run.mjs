import {
  airCompiler,
  createExperimentManifest,
  executeAttempt,
  experimentConfiguration,
  host,
  initializeRun,
  makeSchedule,
  root,
  spawnCapture,
} from "./lib.mjs";

const configuration = experimentConfiguration(process.argv.slice(2));

await requireSuccessful(
  "AIR compiler build",
  "cargo",
  ["build", "--locked", "--bin", "air"],
  120_000,
);
await requireSuccessful(
  "shared benchmark host build",
  "cargo",
  ["build", "--release", "--locked", "--manifest-path", "benchmark-runner/Cargo.toml"],
  300_000,
);
await requireSuccessful("AIR compiler availability", airCompiler, ["--help"], 30_000, [0, 1]);
await requireSuccessful("shared host availability", host, [], 30_000, [1]);

const manifest = createExperimentManifest(configuration);
const schedule = makeSchedule(configuration);
process.stdout.write(
  `${JSON.stringify({
    event: "experiment_started",
    experiment_id: configuration.experimentId,
    model: configuration.model,
    reasoning: configuration.reasoning,
    scheduled_runs: schedule.length,
  })}\n`,
);

for (const item of schedule) {
  let result = initializeRun(
    configuration,
    item.target,
    item.runNumber,
    manifest,
  );
  if (result.status === "completed") {
    progress("run_skipped", result);
    continue;
  }
  progress("run_started", result);
  while (result.status !== "completed") {
    const attemptNumber = result.attempts.length;
    process.stdout.write(
      `${JSON.stringify({
        event: "attempt_started",
        target: result.target,
        run: result.run,
        attempt: attemptNumber,
      })}\n`,
    );
    result = await executeAttempt(configuration, result);
    const attempt = result.attempts.at(-1);
    process.stdout.write(
      `${JSON.stringify({
        event: "attempt_completed",
        target: result.target,
        run: result.run,
        attempt: attempt.attempt,
        full_success: attempt.evaluation.full_success,
        failure_category: attempt.evaluation.failure.primary_category,
        tokens: attempt.codex.usage?.total_tokens ?? null,
        latency_ms: attempt.codex.latency_ms,
      })}\n`,
    );
  }
  progress("run_completed", result);
}

process.stdout.write(
  `${JSON.stringify({ event: "experiment_schedule_completed", experiment_id: configuration.experimentId })}\n`,
);

async function requireSuccessful(name, command, arguments_, timeoutMilliseconds, accepted = [0]) {
  const result = await spawnCapture(command, arguments_, { cwd: root, timeoutMilliseconds });
  if (!accepted.includes(result.exitCode)) {
    throw new Error(`${name} failed:\n${result.stdout}${result.stderr}`);
  }
}

function progress(event, result) {
  process.stdout.write(
    `${JSON.stringify({
      event,
      target: result.target,
      run: result.run,
      status: result.status,
      attempts: result.attempts.length,
      success: result.final?.full_success ?? null,
    })}\n`,
  );
}
