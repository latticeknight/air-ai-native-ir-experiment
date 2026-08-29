import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateProject } from "./evaluate.mjs";
import { experimentRoot } from "./state.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "air-drift-calibration-"));

try {
  const baseline = workspace("baseline-control", "baseline");
  const baselineControl = await evaluateProject({ workspace: baseline, pipeline: "baseline", version: 1 });
  assert.equal(fullSuccess(baselineControl), true, "baseline control must pass");

  const air = workspace("air-control", "air");
  const airControl = await evaluateProject({ workspace: air, pipeline: "air", version: 1 });
  assert.equal(fullSuccess(airControl), true, "AIR-contract control must pass");

  const policyMutation = workspace("baseline-policy-mutation", "baseline");
  const policyFile = path.join(policyMutation, "capability-policy.json");
  const policy = readJson(policyFile);
  policy.allowed_imports.push({ module: "wasi_snapshot_preview1", name: "environ_get" });
  writeJson(policyFile, policy);
  const policyResult = await evaluateProject({
    workspace: policyMutation,
    pipeline: "baseline",
    version: 1,
  });
  assert.equal(policyResult.capability.exact, false, "extra project authority must be detected");
  assert.equal(requirement(policyResult, "LD-001-capability-boundary").passed, false);

  const contractMutation = workspace("air-stale-generated", "air");
  const contractFile = path.join(contractMutation, "air.contract.json");
  const contract = readJson(contractFile);
  contract.capabilities.push({
    id: "users.get",
    module: "air_users_v1",
    name: "get_user",
  });
  writeJson(contractFile, contract);
  const contractResult = await evaluateProject({
    workspace: contractMutation,
    pipeline: "air",
    version: 1,
  });
  assert.equal(contractResult.capability.exact, false, "contract capability creep must be detected");
  assert.ok(
    contractResult.artifact_consistency.checks.some(
      (check) => check.id.startsWith("generated_") && !check.passed,
    ),
    "stale generated artifacts must be detected",
  );
  assert.equal(requirement(contractResult, "LD-001-capability-boundary").passed, false);

  const testMutation = workspace("baseline-test-mutation", "baseline");
  const casesFile = path.join(testMutation, "tests/visible-cases.json");
  const cases = readJson(casesFile);
  cases.requirements = cases.requirements.filter((id) => id !== "LD-001-duplicate-email");
  writeJson(casesFile, cases);
  const testResult = await evaluateProject({
    workspace: testMutation,
    pipeline: "baseline",
    version: 1,
  });
  assert.ok(
    testResult.artifact_consistency.checks.some(
      (check) => check.id === "visible_tests_cover_active_requirements" && !check.passed,
    ),
    "test coverage drift must be detected",
  );

  process.stdout.write("longitudinal oracle control and drift calibration tests passed\n");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function workspace(name, pipeline) {
  const destination = path.join(temporary, name);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(experimentRoot, "templates/base"), destination, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("target"),
  });
  fs.cpSync(path.join(experimentRoot, `templates/${pipeline}`), destination, { recursive: true });
  return destination;
}

function fullSuccess(result) {
  return result.build.success
    && result.runtime.started
    && result.retained_intent.passed === result.retained_intent.total
    && result.obsolete_behavior.failures === 0
    && result.capability.exact
    && result.artifact_consistency.passed === result.artifact_consistency.total;
}

function requirement(result, id) {
  return result.retained_intent.requirements.find((item) => item.id === id);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
