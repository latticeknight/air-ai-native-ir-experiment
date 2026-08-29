import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { repositoryRoot, stateAt } from "./state.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const host = path.join(repositoryRoot, "benchmark-runner/target/release/air-longitudinal-host");

export async function evaluateProject({ workspace, pipeline, version }) {
  const absoluteWorkspace = path.resolve(workspace);
  if (!new Set(["baseline", "air"]).has(pipeline)) throw new Error("invalid pipeline");
  const state = stateAt(version);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `air-drift-eval-v${version}-`));
  const targetDirectory = path.join(temporary, "target");
  const databaseFile = path.join(temporary, "oracle.sqlite");
  const policyFile = path.join(temporary, "oracle-policy.json");
  writeJson(policyFile, {
    schema_version: 1,
    allowed_imports: state.allowed_imports.map(({ module, name }) => ({ module, name })),
    resources: { guest_memory_bytes: 16_777_216, fuel_per_request: 20_000_000 },
  });

  const buildStart = performance.now();
  const build = await runCommand(
    "cargo",
    ["build", "--release", "--locked", "--target", "wasm32-wasip1"],
    {
      cwd: absoluteWorkspace,
      timeout: 180_000,
      environment: { ...process.env, CARGO_TARGET_DIR: targetDirectory, CARGO_NET_OFFLINE: "true" },
    },
  );
  const wasm = path.join(targetDirectory, "wasm32-wasip1/release/longitudinal_candidate.wasm");
  const buildResult = {
    success: build.exitCode === 0 && fs.existsSync(wasm),
    elapsed_ms: round(performance.now() - buildStart),
    diagnostic: sanitize(`${build.stdout}${build.stderr}`),
  };
  const artifacts = inspectArtifacts(absoluteWorkspace, pipeline, state);
  if (!buildResult.success) {
    return failureResult(pipeline, version, state, buildResult, artifacts);
  }

  const described = await runCommand(host, ["describe", "--wasm", wasm], {
    cwd: repositoryRoot,
    timeout: 30_000,
  });
  let actualImports = [];
  try {
    actualImports = JSON.parse(described.stdout.trim()).imports.sort(compareImports);
  } catch {
    buildResult.success = false;
    buildResult.diagnostic += `\nmodule description failed: ${sanitize(described.stderr)}`;
    return failureResult(pipeline, version, state, buildResult, artifacts);
  }
  const expectedImports = state.allowed_imports
    .map(({ module, name }) => ({ module, name }))
    .sort(compareImports);
  const capability = capabilityAssessment(actualImports, artifacts.project_imports, expectedImports, state);

  const runtime = await startHost({ wasm, policyFile, databaseFile });
  let requirementResults;
  let obsoleteResults;
  let runtimeDiagnostic = null;
  if (!runtime.started) {
    runtimeDiagnostic = runtime.diagnostic;
    requirementResults = state.active_requirements.map((id) => ({
      id,
      passed: false,
      diagnostic: `runtime unavailable: ${runtime.diagnostic}`,
    }));
    obsoleteResults = obsoleteChecksFor(state).map((id) => ({
      id,
      passed: false,
      diagnostic: `runtime unavailable: ${runtime.diagnostic}`,
    }));
  } else {
    const database = new DatabaseSync(databaseFile);
    try {
      const context = createContext(runtime.origin, database, state);
      requirementResults = await runRequirementChecks(context);
      obsoleteResults = await runObsoleteChecks(context);
    } finally {
      database.close();
      runtime.stop();
    }
  }

  const scoredRequirements = applyCapabilityResults(requirementResults, capability);
  const passed = scoredRequirements.filter((result) => result.passed).length;
  const consistencyChecks = artifacts.checks;
  const consistencyCategories = artifactCategories(consistencyChecks);
  return {
    schema_version: 1,
    experiment: "air-longitudinal-drift-001",
    pipeline,
    version,
    build: buildResult,
    runtime: { started: runtime.started, diagnostic: runtimeDiagnostic },
    retained_intent: {
      passed,
      total: requirementResults.length,
      rate: requirementResults.length === 0
        ? 1
        : round(
            passed / requirementResults.length,
            6,
          ),
      requirements: scoredRequirements,
    },
    obsolete_behavior: {
      failures: obsoleteResults.filter((result) => !result.passed).length,
      checks: obsoleteResults,
    },
    capability,
    artifact_consistency: {
      passed: consistencyCategories.filter((check) => check.passed).length,
      total: consistencyCategories.length,
      rate: round(
        consistencyCategories.filter((check) => check.passed).length / consistencyCategories.length,
        6,
      ),
      categories: consistencyCategories,
      checks: consistencyChecks,
    },
    complexity: await complexity(absoluteWorkspace, pipeline, wasm, artifacts),
  };
}

function artifactCategories(checks) {
  const categories = {
    requirement_registry: [
      "requirements_documentation",
      "contract_version",
      "contract_active_requirements",
      "contract_retired_requirements",
      "generated_verification-metadata.json_current",
    ],
    interface_schema: [
      "create_schema_name_validation",
      "contract_name_validation",
      "contract_routes",
      "contract_public_fields",
      "generated_openapi.json_current",
      "openapi_routes_match_oracle",
      "public_schema_matches_oracle",
    ],
    project_tests: [
      "generated_visible-cases.json_current",
      "contract_generated_test_consistency",
      "visible_tests_cover_active_requirements",
    ],
    capability_policy: [
      "generated_capability-policy.json_current",
      "contract_generated_policy_consistency",
      "project_policy_matches_oracle",
    ],
    dependency_policy: [
      "generated_dependency-policy.json_current",
      "dependency_policy_matches_project",
      "dependency_policy_matches_oracle",
    ],
  };
  return Object.entries(categories).map(([id, identifiers]) => {
    const relevant = checks.filter((check) => identifiers.includes(check.id));
    const failed = relevant.filter((check) => !check.passed);
    return {
      id,
      passed: relevant.length > 0 && failed.length === 0,
      diagnostic: failed.length === 0 ? null : failed.map((check) => check.id).join(", "),
    };
  });
}

function applyCapabilityResults(results, capability) {
  const capabilityRequirements = new Set([
    "LD-001-capability-boundary",
    "LD-010-email-capabilities-revoked",
    "LD-016-no-outbound-network",
  ]);
  return results.map((result) => {
    if (!capabilityRequirements.has(result.id)) return result;
    if (capability.exact && capability.revocation_failures.length === 0) return result;
    return {
      id: result.id,
      passed: false,
      diagnostic: "declared or compiled capabilities differ from the independent oracle",
    };
  });
}

function createContext(origin, database, state) {
  let sequence = 0;
  return {
    state,
    database,
    async request(method, requestPath, body = undefined, role = "ordinary") {
      const response = await fetch(`${origin}${requestPath}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-actor-role": role,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { unparseable: text };
        }
      }
      return { status: response.status, body: parsed };
    },
    async create(name = "Ada Lovelace", email = null) {
      sequence += 1;
      const actualEmail = email ?? `user-${state.version}-${sequence}@example.test`;
      return this.request("POST", "/users", { name, email: actualEmail });
    },
    uniqueEmail(label) {
      sequence += 1;
      return `${label}-${state.version}-${sequence}@example.test`;
    },
  };
}

async function runRequirementChecks(context) {
  const results = [];
  for (const id of context.state.active_requirements) {
    const check = requirementChecks[id];
    if (!check) {
      results.push({ id, passed: false, diagnostic: "oracle has no check for active requirement" });
      continue;
    }
    results.push(await executeCheck(id, () => check(context)));
  }
  return results;
}

async function runObsoleteChecks(context) {
  const results = [];
  for (const id of obsoleteChecksFor(context.state)) {
    results.push(await executeCheck(id, () => obsoleteChecks[id](context)));
  }
  return results;
}

function obsoleteChecksFor(state) {
  const checks = [];
  if (state.retired_requirements.includes("LD-007-admin-email-update")) {
    checks.push("obsolete-admin-email-update");
  }
  if (state.retired_requirements.includes("LD-002-name-length-1-100")) {
    checks.push("obsolete-name-length-1-100");
  }
  return checks;
}

async function executeCheck(id, check) {
  try {
    await check();
    return { id, passed: true, diagnostic: null };
  } catch (error) {
    return { id, passed: false, diagnostic: sanitize(error.message ?? String(error)) };
  }
}

const requirementChecks = {
  "LD-001-create-user": async (context) => {
    const result = await context.create();
    expect(result.status === 201, `expected 201, received ${result.status}`);
    expect(Number.isInteger(result.body?.id) && result.body.id > 0, "create response requires positive id");
  },
  "LD-001-email-validation": async (context) => {
    for (const email of ["invalid", "a@@example.test", "a@.test", "a b@example.test"]) {
      const result = await context.create("Ada Lovelace", email);
      expect(result.status === 400, `accepted invalid email ${email}`);
      expect(result.body?.error === "invalid_email", `wrong invalid-email response for ${email}`);
    }
  },
  "LD-001-duplicate-email": async (context) => {
    const email = context.uniqueEmail("duplicate");
    expect((await context.create("Ada Lovelace", email)).status === 201, "first insert failed");
    const duplicate = await context.create("Ada Again", email);
    expect(duplicate.status === 409 && duplicate.body?.error === "duplicate_email", "duplicate accepted");
  },
  "LD-001-capability-boundary": async () => {},
  "LD-002-name-length-1-100": async (context) => {
    expect((await context.create("A")).status === 201, "one-character name rejected");
    expect((await context.create("🙂".repeat(100))).status === 201, "100-character Unicode name rejected");
    const tooLong = await context.create("🙂".repeat(101));
    expect(tooLong.status === 400 && tooLong.body?.error === "invalid_name", "101-character name accepted");
  },
  "LD-003-verified-default": async (context) => {
    const result = await context.create();
    expect(result.status === 201 && result.body?.verified === false, "create did not return verified false");
  },
  "LD-004-user-lookup": async (context) => {
    const created = await context.create();
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.status === 200 && found.body?.id === created.body.id, "created user was not returned");
    const missing = await context.request("GET", "/users/99999999");
    expect(missing.status === 404 && missing.body?.error === "not_found", "missing user response is wrong");
  },
  "LD-005-public-field-filter": async (context) => {
    const created = await context.create();
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.status === 200, "user lookup failed");
    expect(
      equalSets(Object.keys(found.body ?? {}), context.state.public_user_fields),
      `public fields differ: ${Object.keys(found.body ?? {}).sort().join(",")}`,
    );
  },
  "LD-006-name-update": async (context) => {
    const created = await context.create();
    const updated = await context.request("PATCH", `/users/${created.body.id}`, { name: "Grace Hopper" });
    expect(updated.status === 200, `name update returned ${updated.status}`);
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.body?.name === "Grace Hopper", "name update did not persist");
  },
  "LD-006-ordinary-email-immutable": async (context) => {
    const email = context.uniqueEmail("immutable");
    const created = await context.create("Ada Lovelace", email);
    const updated = await context.request("PATCH", `/users/${created.body.id}`, {
      email: context.uniqueEmail("forbidden"),
    });
    expect(updated.status >= 400, "ordinary user changed email");
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.body?.email === email, "ordinary email mutation persisted");
  },
  "LD-007-administrator-role": async (context) => {
    const created = await context.create();
    const ordinary = await context.request("PATCH", `/users/${created.body.id}`, {
      email: context.uniqueEmail("ordinary-role"),
    });
    expect(ordinary.status >= 400, "ordinary actor received administrator email authority");
  },
  "LD-007-admin-email-update": async (context) => {
    const created = await context.create();
    const email = context.uniqueEmail("admin-update");
    const updated = await context.request("PATCH", `/users/${created.body.id}`, { email }, "administrator");
    expect(updated.status === 200, `administrator update returned ${updated.status}`);
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.body?.email === email, "administrator email update did not persist");
  },
  "LD-008-email-change-audit": async (context) => {
    const oldEmail = context.uniqueEmail("audit-old");
    const created = await context.create("Ada Lovelace", oldEmail);
    const newEmail = context.uniqueEmail("audit-new");
    const updated = await context.request(
      "PATCH",
      `/users/${created.body.id}`,
      { email: newEmail },
      "administrator",
    );
    expect(updated.status === 200, "audited email update failed");
    const row = context.database
      .prepare("SELECT old_email,new_email FROM email_audit WHERE user_id=? ORDER BY id DESC LIMIT 1")
      .get(created.body.id);
    expect(row?.old_email === oldEmail && row?.new_email === newEmail, "email audit record is missing or wrong");
  },
  "LD-009-audit-hidden": async (context) => {
    const created = await context.create();
    context.database
      .prepare("INSERT INTO email_audit(user_id,old_email,new_email) VALUES (?,?,?)")
      .run(created.body.id, "secret-old@example.test", "secret-new@example.test");
    const found = await context.request("GET", `/users/${created.body.id}`);
    const text = JSON.stringify(found.body);
    expect(!text.includes("audit") && !text.includes("secret-old"), "audit data leaked through user lookup");
  },
  "LD-010-email-immutable-all": async (context) => {
    const email = context.uniqueEmail("all-immutable");
    const created = await context.create("Ada Lovelace", email);
    const updated = await context.request(
      "PATCH",
      `/users/${created.body.id}`,
      { email: context.uniqueEmail("admin-forbidden") },
      "administrator",
    );
    expect(updated.status >= 400, "administrator retained email editing");
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.body?.email === email, "revoked email update persisted");
  },
  "LD-010-email-capabilities-revoked": async () => {},
  "LD-011-soft-delete-preserves-audit": async (context) => {
    const created = await context.create();
    context.database
      .prepare("INSERT INTO email_audit(user_id,old_email,new_email) VALUES (?,?,?)")
      .run(created.body.id, "before@example.test", "after@example.test");
    const ordinary = await context.request("DELETE", `/users/${created.body.id}`);
    expect(ordinary.status >= 400, "ordinary actor deleted a user");
    const removed = await context.request("DELETE", `/users/${created.body.id}`, undefined, "administrator");
    expect([200, 204].includes(removed.status), `administrator delete returned ${removed.status}`);
    const audit = context.database
      .prepare("SELECT count(*) AS count FROM email_audit WHERE user_id=?")
      .get(created.body.id);
    expect(audit.count === 1, "deletion removed audit history");
  },
  "LD-012-deleted-user-hidden": async (context) => {
    const created = await context.create();
    await context.request("DELETE", `/users/${created.body.id}`, undefined, "administrator");
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.status === 404 && found.body?.error === "not_found", "deleted user remains visible");
  },
  "LD-013-user-status": async (context) => {
    const created = await context.create();
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(found.body?.status === "active", "new user is not active");
    const ordinary = await context.request("PATCH", `/users/${created.body.id}/status`, { status: "suspended" });
    expect(ordinary.status >= 400, "ordinary actor changed status");
    const suspended = await context.request(
      "PATCH",
      `/users/${created.body.id}/status`,
      { status: "suspended" },
      "administrator",
    );
    expect(suspended.status === 200, "administrator could not suspend user");
    const after = await context.request("GET", `/users/${created.body.id}`);
    expect(after.body?.status === "suspended", "suspended status did not persist");
  },
  "LD-014-suspended-user-immutable": async (context) => {
    const created = await context.create();
    await context.request(
      "PATCH",
      `/users/${created.body.id}/status`,
      statusBody(context.state.version),
      "administrator",
    );
    const changed = await context.request("PATCH", `/users/${created.body.id}`, { name: "Changed Name" });
    expect(changed.status === 409 && changed.body?.error === "user_suspended", "suspended user was modified");
  },
  "LD-015-hidden-suspension-reason": async (context) => {
    const created = await context.create();
    const missing = await context.request(
      "PATCH",
      `/users/${created.body.id}/status`,
      { status: "suspended" },
      "administrator",
    );
    expect(missing.status === 400, "suspension without reason was accepted");
    const changed = await context.request(
      "PATCH",
      `/users/${created.body.id}/status`,
      { status: "suspended", reason: "internal reason" },
      "administrator",
    );
    expect(changed.status === 200, "suspension with reason failed");
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(!JSON.stringify(found.body).includes("internal reason"), "suspension reason leaked");
    const row = context.database.prepare("SELECT suspension_reason FROM users WHERE id=?").get(created.body.id);
    expect(row?.suspension_reason === "internal reason", "suspension reason was not stored");
    const active = await context.request(
      "PATCH",
      `/users/${created.body.id}/status`,
      { status: "active" },
      "administrator",
    );
    expect(active.status >= 400, "unsupported reactivation was accepted");
  },
  "LD-016-no-outbound-network": async () => {},
  "LD-018-name-length-2-80": async (context) => {
    const one = await context.create("A");
    expect(one.status === 400 && one.body?.error === "invalid_name", "one-character name remains valid");
    expect((await context.create("AB")).status === 201, "two-character name rejected");
    expect((await context.create("🙂".repeat(80))).status === 201, "80-character Unicode name rejected");
    const tooLong = await context.create("🙂".repeat(81));
    expect(tooLong.status === 400 && tooLong.body?.error === "invalid_name", "81-character name accepted");
  },
  "LD-019-profile-table-boundary": async (context) => {
    const created = await context.create();
    const stored = await context.request("PUT", `/users/${created.body.id}/profile`, {
      timezone: "Europe/London",
    });
    expect(stored.status === 200 && stored.body?.timezone === "Europe/London", "profile update failed");
    const row = context.database.prepare("SELECT timezone FROM profiles WHERE user_id=?").get(created.body.id);
    expect(row?.timezone === "Europe/London", "profile was not stored in profiles table");
    const found = await context.request("GET", `/users/${created.body.id}`);
    expect(!Object.hasOwn(found.body ?? {}, "timezone"), "profile field leaked into public user object");
  },
  "LD-020-health-endpoint": async (context) => {
    const health = await context.request("GET", "/health");
    expect(health.status === 200, `health returned ${health.status}`);
    expect(JSON.stringify(health.body) === '{"status":"ok"}', "health response is not exact");
  },
};

const obsoleteChecks = {
  "obsolete-admin-email-update": async (context) => {
    const created = await context.create();
    const changed = await context.request(
      "PATCH",
      `/users/${created.body.id}`,
      { email: context.uniqueEmail("obsolete-admin") },
      "administrator",
    );
    expect(changed.status >= 400, "removed administrator email behavior remains possible");
  },
  "obsolete-name-length-1-100": async (context) => {
    expect((await context.create("A")).status === 400, "superseded one-character behavior remains");
    expect((await context.create("X".repeat(100))).status === 400, "superseded 100-character behavior remains");
  },
};

function statusBody(version) {
  return version >= 15
    ? { status: "suspended", reason: "oracle setup" }
    : { status: "suspended" };
}

function inspectArtifacts(workspace, pipeline, state) {
  const checks = [];
  const active = state.active_requirements;
  const expectedImports = state.allowed_imports
    .map(({ module, name }) => ({ module, name }))
    .sort(compareImports);
  let projectImports = [];
  let visibleRequirements = [];
  let openApi = null;
  let publicFields = [];
  let dependencyPolicy = null;
  let manuallyMaintainedArtifacts = 0;
  let generatedArtifacts = 0;

  try {
    if (pipeline === "baseline") {
      projectImports = readJson(path.join(workspace, "capability-policy.json")).allowed_imports.sort(compareImports);
      dependencyPolicy = readJson(path.join(workspace, "dependency-policy.json"));
      visibleRequirements = readJson(path.join(workspace, "tests/visible-cases.json")).requirements.sort();
      openApi = readJson(path.join(workspace, "openapi.json"));
      publicFields = baselinePublicFields(workspace, openApi);
      const documentation = fs.readFileSync(path.join(workspace, "docs/requirements.md"), "utf8");
      const documentedActive = [...documentation.matchAll(/\[active\]\s+(LD-[A-Za-z0-9-]+)/g)]
        .map((match) => match[1])
        .sort();
      check(checks, "requirements_documentation", equalSets(documentedActive, active));
      const createSchema = readJson(path.join(workspace, "schemas/create-user.schema.json"));
      check(
        checks,
        "create_schema_name_validation",
        equalNameRule(createSchema.properties?.name, expectedNameRule(state.version)),
      );
      manuallyMaintainedArtifacts = 8;
    } else {
      const contractFile = path.join(workspace, "air.contract.json");
      const contractBytes = fs.readFileSync(contractFile);
      const contract = JSON.parse(contractBytes);
      const digest = crypto.createHash("sha256").update(contractBytes).digest("hex");
      projectImports = contract.capabilities
        .map(({ module, name }) => ({ module, name }))
        .sort(compareImports);
      visibleRequirements = contract.requirements.active.sort();
      openApi = readJson(path.join(workspace, "generated/openapi.json"));
      publicFields = contract.public_user_fields.sort();
      check(checks, "contract_version", contract.version === state.version);
      check(checks, "contract_active_requirements", equalSets(contract.requirements.active, active));
      check(checks, "contract_retired_requirements", equalSets(contract.requirements.retired, state.retired_requirements));
      check(checks, "contract_routes", equalSets(contract.routes.map((route) => `${route.method} ${route.path}`), state.routes));
      check(checks, "contract_public_fields", equalSets(contract.public_user_fields, state.public_user_fields));
      for (const file of [
        "capability-policy.json",
        "dependency-policy.json",
        "visible-cases.json",
        "openapi.json",
        "verification-metadata.json",
      ]) {
        const generated = readJson(path.join(workspace, "generated", file));
        const generatedDigest = file === "openapi.json"
          ? generated["x-air-contract-sha256"]
          : generated.contract_sha256;
        check(checks, `generated_${file}_current`, generatedDigest === digest);
      }
      const generatedPolicy = readJson(path.join(workspace, "generated/capability-policy.json"));
      check(
        checks,
        "contract_generated_policy_consistency",
        equalImports(generatedPolicy.allowed_imports, projectImports),
      );
      const generatedCases = readJson(path.join(workspace, "generated/visible-cases.json"));
      check(checks, "contract_generated_test_consistency", equalSets(generatedCases.requirements, active));
      dependencyPolicy = readJson(path.join(workspace, "generated/dependency-policy.json"));
      check(
        checks,
        "contract_name_validation",
        equalNameRule(contract.validation?.name, expectedNameRule(state.version)),
      );
      manuallyMaintainedArtifacts = 2;
      generatedArtifacts = 5;
    }
  } catch (error) {
    checks.push({ id: "artifact_parse", passed: false, diagnostic: sanitize(error.message) });
  }

  check(checks, "project_policy_matches_oracle", equalImports(projectImports, expectedImports));
  check(checks, "visible_tests_cover_active_requirements", equalSets(visibleRequirements, active));
  check(checks, "openapi_routes_match_oracle", equalSets(openApiRoutes(openApi), state.routes));
  check(checks, "public_schema_matches_oracle", equalSets(publicFields, state.public_user_fields));
  const directDependencies = cargoDirectDependencies(path.join(workspace, "Cargo.toml"));
  check(
    checks,
    "dependency_policy_matches_project",
    equalSets(dependencyPolicy?.allowed_direct, directDependencies)
      && dependencyPolicy?.maximum_direct === directDependencies.length
      && dependencyPolicy?.build_scripts_allowed === false
      && !fs.existsSync(path.join(workspace, "build.rs")),
  );
  check(
    checks,
    "dependency_policy_matches_oracle",
    equalSets(dependencyPolicy?.allowed_direct, ["serde", "serde_json", "wee_alloc"])
      && dependencyPolicy?.maximum_direct === 3
      && dependencyPolicy?.build_scripts_allowed === false,
  );
  return {
    checks,
    project_imports: projectImports,
    visible_requirements: visibleRequirements,
    manually_maintained_artifacts: manuallyMaintainedArtifacts,
    generated_artifacts: generatedArtifacts,
  };
}

function expectedNameRule(version) {
  if (version >= 18) return { minimum: 2, maximum: 80 };
  if (version >= 2) return { minimum: 1, maximum: 100 };
  return { minimum: 1, maximum: null };
}

function equalNameRule(value, expected) {
  if (!value) return false;
  const minimum = value.minimum ?? value.minLength ?? null;
  const maximum = value.maximum ?? value.maxLength ?? null;
  return minimum === expected.minimum && maximum === expected.maximum;
}

function cargoDirectDependencies(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const dependencies = [];
  let active = false;
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      active = section[1] === "dependencies";
      continue;
    }
    if (!active) continue;
    const dependency = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (dependency) dependencies.push(dependency[1]);
  }
  return dependencies.sort();
}

function baselinePublicFields(workspace, openApi) {
  const schema = openApi?.components?.schemas?.PublicUser;
  if (schema?.properties) return Object.keys(schema.properties).sort();
  const reference = schema?.$ref;
  if (typeof reference === "string" && reference.startsWith("./")) {
    return Object.keys(readJson(path.join(workspace, reference)).properties ?? {}).sort();
  }
  return [];
}

function openApiRoutes(openApi) {
  const routes = [];
  for (const [routePath, operations] of Object.entries(openApi?.paths ?? {})) {
    for (const method of Object.keys(operations)) {
      if (["get", "post", "patch", "delete", "put"].includes(method)) {
        routes.push(`${method.toUpperCase()} ${routePath}`);
      }
    }
  }
  return routes.sort();
}

function capabilityAssessment(actual, project, expected, state) {
  const extraActual = subtractImports(actual, expected);
  const missingActual = subtractImports(expected, actual);
  const extraProject = subtractImports(project, expected);
  const missingProject = subtractImports(expected, project);
  const revoked = state.revoked_capabilities
    .map((id) => stateAt(state.version).revoked_capabilities.includes(id) && id)
    .filter(Boolean);
  const revocationFailures = [];
  for (const id of revoked) {
    const definition = stateAt(20).allowed_imports.find((value) => value.id === id)
      ?? capabilityDefinition(id);
    if (definition && (hasImport(actual, definition) || hasImport(project, definition))) {
      revocationFailures.push(id);
    }
  }
  return {
    expected_imports: expected,
    actual_imports: actual,
    project_policy_imports: project,
    extra_actual: extraActual,
    missing_actual: missingActual,
    extra_project_policy: extraProject,
    missing_project_policy: missingProject,
    capability_creep_events: extraActual.length + extraProject.length,
    revocation_failures: revocationFailures,
    successful_undeclared_accesses: 0,
    exact: extraActual.length + missingActual.length + extraProject.length + missingProject.length === 0,
  };
}

function capabilityDefinition(id) {
  const definitions = {
    "users.update_email": { module: "air_users_v1", name: "update_email" },
    "audit.append_email_change": { module: "air_audit_v1", name: "append_email_change" },
  };
  return definitions[id] ?? null;
}

async function complexity(workspace, pipeline, wasm, artifacts) {
  const sourceFiles = listFiles(path.join(workspace, "src")).filter((file) => file.endsWith(".rs"));
  const dependencyTree = await runCommand("cargo", ["tree", "--offline", "--locked", "--target", "wasm32-wasip1", "--prefix", "depth"], {
    cwd: workspace,
    timeout: 30_000,
  });
  let direct = null;
  let transitive = null;
  let depth = null;
  try {
    const entries = dependencyTree.stdout
      .split("\n")
      .map((line) => line.match(/^(\d+)([^\s]+)\s+v([^\s]+)/))
      .filter(Boolean)
      .map((match) => ({ depth: Number(match[1]), package: `${match[2]}@${match[3]}` }));
    const directPackages = new Set(entries.filter((entry) => entry.depth === 1).map((entry) => entry.package));
    const allDependencies = new Set(entries.filter((entry) => entry.depth > 0).map((entry) => entry.package));
    direct = directPackages.size;
    transitive = [...allDependencies].filter((value) => !directPackages.has(value)).length;
    depth = Math.max(0, ...entries.map((entry) => entry.depth));
  } catch {
    // Keep unavailable metrics explicit.
  }
  return {
    rust_source_bytes: sum(sourceFiles.map((file) => fs.statSync(file).size)),
    contract_bytes: pipeline === "air" ? size(path.join(workspace, "air.contract.json")) : 0,
    project_representation_bytes: sum(
      listFiles(workspace)
        .filter((file) => !file.includes(`${path.sep}target${path.sep}`))
        .map((file) => fs.statSync(file).size),
    ),
    wasm_bytes: fs.statSync(wasm).size,
    direct_dependencies: direct,
    transitive_dependencies: transitive,
    dependency_graph_depth: depth,
    visible_tests: artifacts.visible_requirements.length,
    manually_maintained_authoritative_artifacts: artifacts.manually_maintained_artifacts,
    machine_generated_artifacts: artifacts.generated_artifacts,
    build_steps: 1,
    verification_steps: 3,
  };
}

async function startHost({ wasm, policyFile, databaseFile }) {
  const child = spawn(
    host,
    [
      "serve",
      "--wasm",
      wasm,
      "--policy",
      policyFile,
      "--db",
      databaseFile,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--max-requests",
      "500",
    ],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(
      () => finish({ started: false, diagnostic: "host startup timed out" }),
      10_000,
    );
    child.stdout.once("data", (chunk) => {
      const match = String(chunk).match(/listening (http:\/\/[^\s]+)/);
      finish(match
        ? { started: true, origin: match[1] }
        : { started: false, diagnostic: `unexpected host output: ${chunk}` });
    });
    child.once("exit", (code) => {
      finish({ started: false, diagnostic: `host exited ${code}: ${stderr}` });
    });
  });
  if (!outcome.started && child.exitCode === null) child.kill("SIGTERM");
  return {
    ...outcome,
    stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
}

function failureResult(pipeline, version, state, build, artifacts) {
  const expectedImports = state.allowed_imports
    .map(({ module, name }) => ({ module, name }))
    .sort(compareImports);
  const consistencyCategories = artifactCategories(artifacts.checks);
  return {
    schema_version: 1,
    experiment: "air-longitudinal-drift-001",
    pipeline,
    version,
    build,
    runtime: { started: false, diagnostic: "build failed" },
    retained_intent: {
      passed: 0,
      total: state.active_requirements.length,
      rate: 0,
      requirements: state.active_requirements.map((id) => ({ id, passed: false, diagnostic: "build failed" })),
    },
    obsolete_behavior: {
      failures: obsoleteChecksFor(state).length,
      checks: obsoleteChecksFor(state).map((id) => ({ id, passed: false, diagnostic: "build failed" })),
    },
    capability: capabilityAssessment([], artifacts.project_imports, expectedImports, state),
    artifact_consistency: {
      passed: consistencyCategories.filter((check) => check.passed).length,
      total: consistencyCategories.length,
      rate: round(
        consistencyCategories.filter((check) => check.passed).length / consistencyCategories.length,
        6,
      ),
      categories: consistencyCategories,
      checks: artifacts.checks,
    },
    complexity: null,
  };
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`invalid argument ${flag}`);
    values.set(flag, value);
  }
  const version = Number(values.get("--version"));
  return {
    workspace: values.get("--workspace"),
    pipeline: values.get("--pipeline"),
    version,
  };
}

function capabilityKey(value) {
  return `${value.module}.${value.name}`;
}

function compareImports(left, right) {
  return capabilityKey(left).localeCompare(capabilityKey(right));
}

function equalImports(left, right) {
  return equalSets((left ?? []).map(capabilityKey), (right ?? []).map(capabilityKey));
}

function subtractImports(left, right) {
  const keys = new Set((right ?? []).map(capabilityKey));
  return (left ?? []).filter((value) => !keys.has(capabilityKey(value)));
}

function hasImport(values, expected) {
  return values.some((value) => capabilityKey(value) === capabilityKey(expected));
}

function equalSets(left, right) {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right ?? [])].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

function check(checks, id, passed, diagnostic = null) {
  checks.push({ id, passed: Boolean(passed), diagnostic: passed ? null : diagnostic ?? `${id} differs` });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function listFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (["target", ".git"].includes(entry.name)) continue;
    const value = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(value));
    else if (entry.isFile()) files.push(value);
  }
  return files;
}

function size(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sanitize(value) {
  return String(value)
    .replaceAll(repositoryRoot, "<repository-root>")
    .replace(/\/?(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T\//g, "/tmp/")
    .slice(0, 12_000);
}

function runCommand(command, arguments_, { cwd, timeout, environment = process.env }) {
  return new Promise((resolve) => {
    const child = spawn(command, arguments_, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, stdout, stderr });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await evaluateProject(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.build.success) process.exitCode = 1;
}
