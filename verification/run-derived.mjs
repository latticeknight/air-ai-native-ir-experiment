import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { predicateCounterexamples } from "./contract.mjs";

const options = parseArguments(process.argv.slice(2));
const plan = JSON.parse(fs.readFileSync(options.plan, "utf8"));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "air-derived-verification-"));
const database = path.join(temporaryDirectory, "users.sqlite");
const checks = plan.checks.filter((check) => check.class === "dynamic");
const normalChecks = checks.filter((check) => check.generator !== "capability_unavailable");
const unavailableChecks = checks.filter((check) => check.generator === "capability_unavailable");
const expanded = normalChecks.flatMap(expandCheck);
const results = new Map(checks.map((check) => [check.id, []]));

try {
  const host = await startHost({
    database,
    maxRequests: expanded.reduce((total, test) => total + test.requests.length, 0),
  });
  const databaseAssertions = [];
  try {
    for (const test of expanded) {
      try {
        const responses = [];
        for (const request of test.requests) {
          responses.push(await send(host.origin, plan.runtime.endpoint, request));
        }
        const observation = test.assertResponses(responses);
        results.get(test.check.id).push({ case: test.case, passed: true, observation });
        if (test.databaseAssertion) {
          databaseAssertions.push({ test, responses });
        }
      } catch (error) {
        results.get(test.check.id).push({
          case: test.case,
          passed: false,
          failure: String(error?.message ?? error),
        });
      }
    }
    const exit = await waitForExit(host.child);
    assert.equal(exit.code, 0, host.standardError());
  } finally {
    if (host.child.exitCode === null) host.child.kill("SIGTERM");
  }

  if (databaseAssertions.length > 0) {
    const connection = new DatabaseSync(database, { readOnly: true });
    try {
      for (const assertion of databaseAssertions) {
        const bucket = results.get(assertion.test.check.id);
        const recorded = bucket.find((entry) => entry.case === assertion.test.case);
        if (!recorded?.passed) continue;
        try {
          assertion.test.databaseAssertion(connection, assertion.responses);
        } catch (error) {
          recorded.passed = false;
          recorded.failure = String(error?.message ?? error);
        }
      }
    } finally {
      connection.close();
    }
  }

  for (const check of unavailableChecks) {
    const unavailableDatabase = path.join(temporaryDirectory, `${check.id}.sqlite`);
    const host = await startHost({
      database: unavailableDatabase,
      maxRequests: 1,
      storageUnavailable: true,
    });
    try {
      const response = await send(host.origin, plan.runtime.endpoint, {
        kind: "json",
        body: uniqueInput(check.id),
      });
      assertResponse(response, check.expected);
      results.get(check.id).push({ case: "capability unavailable", passed: true, observation: response });
      const exit = await waitForExit(host.child);
      assert.equal(exit.code, 0, host.standardError());
    } catch (error) {
      results.get(check.id).push({
        case: "capability unavailable",
        passed: false,
        failure: String(error?.message ?? error),
      });
    } finally {
      if (host.child.exitCode === null) host.child.kill("SIGTERM");
    }
  }

  const outputChecks = checks.map((check) => {
    const cases = results.get(check.id);
    return {
      id: check.id,
      generated_from: check.generator,
      passed: cases.length > 0 && cases.every((test) => test.passed),
      cases,
    };
  });
  const output = {
    schema_version: 1,
    plan: path.relative(process.cwd(), options.plan),
    dynamic_checks_passed: outputChecks.filter((check) => check.passed).length,
    dynamic_checks_total: outputChecks.length,
    full_success: outputChecks.every((check) => check.passed),
    checks: outputChecks,
  };
  writeOutput(output);
  process.exitCode = output.full_success ? 0 : 1;
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function expandCheck(check) {
  switch (check.generator) {
    case "omit_required_field": {
      const body = uniqueInput(check.id);
      delete body[check.field];
      return [single(check, `omit ${check.field}`, { kind: "json", body }, check.expected)];
    }
    case "predicate_counterexamples":
      return (predicateCounterexamples[check.predicate] ?? []).map((counterexample, index) => {
        const body = uniqueInput(`${check.id}-${index}`);
        body[check.field] = counterexample;
        return single(
          check,
          `${check.field}=${JSON.stringify(counterexample)}`,
          { kind: "json", body },
          check.expected,
        );
      });
    case "add_unknown_field":
      return [
        single(
          check,
          "unknown input field",
          { kind: "json", body: { ...uniqueInput(check.id), undeclared: true } },
          check.expected,
        ),
      ];
    case "exceed_body_limit":
      return [
        single(
          check,
          "body exceeds maximum",
          {
            kind: "raw",
            body: JSON.stringify({
              ...uniqueInput(check.id),
              name: "x".repeat(check.maximum_bytes),
            }),
          },
          check.expected,
        ),
      ];
    case "valid_input":
      return [single(check, "valid input", { kind: "json", body: uniqueInput(check.id) }, check.expected)];
    case "response_field":
      return [
        {
          check,
          case: `response field ${check.rule.field}`,
          requests: [{ kind: "json", body: uniqueInput(check.id) }],
          assertResponses: ([response]) => {
            assert.equal(response.status, plan.runtime.outcomes[check.rule.outcome].status);
            assert.ok(Number.isInteger(response.body[check.rule.field]) && response.body[check.rule.field] > 0);
            return response;
          },
        },
      ];
    case "database_row_matches_response_id": {
      const body = uniqueInput(check.id);
      return [
        {
          check,
          case: "database row matches returned ID",
          requests: [{ kind: "json", body }],
          assertResponses: ([response]) => {
            assert.equal(response.status, plan.runtime.outcomes.success.status);
            assert.ok(Number.isInteger(response.body[check.rule.response_field]));
            return response;
          },
          databaseAssertion: (connection, [response]) => {
            const effect = plan.runtime.effects.find((candidate) => candidate.id === check.rule.effect);
            assert.ok(effect, `unknown effect ${check.rule.effect}`);
            const id = response.body[check.rule.response_field];
            const row = connection.prepare(`SELECT name, email FROM ${effect.table} WHERE id = ?`).get(id);
            assert.ok(row, `no ${effect.table} row exists for returned id ${id}`);
            for (const [input, column] of Object.entries(check.rule.input_to_columns)) {
              assert.equal(row[column], body[input]);
            }
          },
        },
      ];
    }
    case "unique": {
      const body = uniqueInput(check.id);
      return [
        {
          check,
          case: `unique ${check.rule.columns.join(",")}`,
          requests: [
            { kind: "json", body },
            { kind: "json", body: { ...body, name: "Duplicate name" } },
          ],
          assertResponses: ([first, second]) => {
            assert.equal(first.status, plan.runtime.outcomes.success.status);
            assertResponse(second, check.expected);
            return { first, second };
          },
        },
      ];
    }
    default:
      throw new Error(`unsupported dynamic check generator ${check.generator}`);
  }
}

function single(check, caseName, request, expected) {
  return {
    check,
    case: caseName,
    requests: [request],
    assertResponses: ([response]) => {
      assertResponse(response, expected);
      return response;
    },
  };
}

function uniqueInput(suffix) {
  const safe = suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    ...plan.runtime.valid_input,
    email: `${safe}@example.test`,
  };
}

async function send(origin, endpoint, request) {
  const response = await fetch(`${origin}${endpoint.path}`, {
    method: endpoint.method,
    headers: { "content-type": endpoint.content_type },
    body: request.kind === "raw" ? request.body : JSON.stringify(request.body),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function assertResponse(response, expected) {
  assert.equal(response.status, expected.status);
  if (expected.body.kind === "closed_object") {
    const fields = expected.body.fields;
    assert.deepEqual(Object.keys(response.body).sort(), Object.keys(fields).sort());
    for (const [name, field] of Object.entries(fields)) {
      if (field.required) assert.ok(Object.hasOwn(response.body, name));
      if (field.type === "positive_integer") {
        assert.ok(Number.isInteger(response.body[name]) && response.body[name] > 0);
      }
    }
  } else {
    assert.deepEqual(response.body, expected.body);
  }
}

async function startHost({ database, maxRequests, storageUnavailable = false }) {
  const arguments_ = [
    "serve",
    "--wasm",
    options.wasm,
    "--capability-manifest",
    options.manifest,
    "--db",
    database,
    "--port",
    "0",
    "--max-requests",
    String(maxRequests),
  ];
  if (storageUnavailable) arguments_.push("--storage-unavailable");
  const child = spawn(options.host, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
  let standardError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { standardError += chunk; });
  const origin = await waitForOrigin(child, () => standardError);
  return { child, origin, standardError: () => standardError };
}

function waitForOrigin(child, standardError) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`host did not start: ${standardError()}`)), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/listening (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`host exited before listening with ${code}: ${standardError()}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function writeOutput(value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, json);
  } else {
    process.stdout.write(json);
  }
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    values.set(arguments_[index], arguments_[index + 1]);
  }
  for (const name of ["--plan", "--host", "--wasm", "--manifest"]) {
    if (!values.get(name)) throw new Error(`missing ${name}`);
  }
  return {
    plan: path.resolve(values.get("--plan")),
    host: path.resolve(values.get("--host")),
    wasm: path.resolve(values.get("--wasm")),
    manifest: path.resolve(values.get("--manifest")),
    output: values.get("--output") ? path.resolve(values.get("--output")) : null,
  };
}
