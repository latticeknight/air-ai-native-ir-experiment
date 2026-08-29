import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const options = parseArguments(process.argv.slice(2));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "air-rust-benchmark-"));
const databasePath = path.join(temporaryDirectory, "users.sqlite");
const results = [];

const warmupRequests = 10;
const latencyRequests = 50;
const throughputRequests = 20;
const functionalRequests = 18;
const host = await startHost({
  database: databasePath,
  maxRequests: functionalRequests + warmupRequests + latencyRequests + throughputRequests,
});

try {
  await test("valid user", async () => {
    const response = await jsonRequest(host.origin, { name: "Ada", email: "ada@example.test" });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { id: 1 });
  });

  await test("invalid email", async () => {
    const response = await jsonRequest(host.origin, { name: "Invalid", email: "not-an-email" });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_email" });
  });

  await test("missing name", async () => {
    const response = await jsonRequest(host.origin, { email: "missing-name@example.test" });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_json" });
  });

  await test("missing email", async () => {
    const response = await jsonRequest(host.origin, { name: "Missing Email" });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_json" });
  });

  await test("empty name", async () => {
    const response = await jsonRequest(host.origin, {
      name: "",
      email: "empty-name@example.test",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_name" });
  });

  await test("malformed JSON", async () => {
    const response = await rawRequest(host.origin, "{");
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_json" });
  });

  await test("duplicate email", async () => {
    const response = await jsonRequest(host.origin, { name: "Ada Again", email: "ada@example.test" });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "duplicate_email" });
  });

  await test("large input", async () => {
    const response = await jsonRequest(host.origin, {
      name: "x".repeat(33_000),
      email: "large@example.test",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_json" });
  });

  await test("Unicode input", async () => {
    const response = await jsonRequest(host.origin, {
      name: "Zoë 東京",
      email: "álîçé@例.测试",
    });
    assert.equal(response.status, 201);
    assert.ok(Number.isInteger(response.body.id) && response.body.id > 0);
  });

  const sqlLookingName = "Robert'); DROP TABLE users;--";
  await test("SQL-injection-like input", async () => {
    const response = await jsonRequest(host.origin, {
      name: sqlLookingName,
      email: "sql@example.test",
    });
    assert.equal(response.status, 201);
    assert.ok(Number.isInteger(response.body.id) && response.body.id > 0);
  });

  await test("concurrent inserts", async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        jsonRequest(host.origin, {
          name: `Concurrent ${index}`,
          email: `concurrent-${index}@example.test`,
        }),
      ),
    );
    assert.ok(responses.every((response) => response.status === 201));
    const ids = responses.map((response) => response.body.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (let index = 0; index < warmupRequests; index += 1) {
    const response = await jsonRequest(host.origin, {
      name: `Warmup ${index}`,
      email: `warmup-${index}@example.test`,
    });
    assert.equal(response.status, 201);
  }

  const latencies = [];
  for (let index = 0; index < latencyRequests; index += 1) {
    const start = performance.now();
    const response = await jsonRequest(host.origin, {
      name: `Latency ${index}`,
      email: `latency-${index}@example.test`,
    });
    latencies.push(performance.now() - start);
    assert.equal(response.status, 201);
  }

  const throughputStart = performance.now();
  const throughputResponses = await Promise.all(
    Array.from({ length: throughputRequests }, (_, index) =>
      jsonRequest(host.origin, {
        name: `Throughput ${index}`,
        email: `throughput-${index}@example.test`,
      }),
    ),
  );
  const throughputMilliseconds = performance.now() - throughputStart;
  assert.ok(throughputResponses.every((response) => response.status === 201));

  const hostExit = await waitForExit(host.child);
  assert.equal(hostExit.code, 0, host.standardError());

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const storedSqlName = database
    .prepare("SELECT name FROM users WHERE email = ?")
    .get("sql@example.test")?.name;
  const tableStillExists = database
    .prepare("SELECT COUNT(*) AS count FROM users")
    .get().count;
  database.close();
  const sqlTest = results.find((result) => result.name === "SQL-injection-like input");
  if (sqlTest?.passed && (storedSqlName !== sqlLookingName || tableStillExists < 1)) {
    sqlTest.passed = false;
    sqlTest.failure = "SQL-looking text was not stored literally";
  }

  const unavailableHost = await startHost({
    database: path.join(temporaryDirectory, "unavailable.sqlite"),
    maxRequests: 1,
    storageUnavailable: true,
  });
  await test("database unavailable", async () => {
    const response = await jsonRequest(unavailableHost.origin, {
      name: "Unavailable",
      email: "unavailable@example.test",
    });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: "storage_failure" });
  });
  const unavailableExit = await waitForExit(unavailableHost.child);
  assert.equal(unavailableExit.code, 0, unavailableHost.standardError());

  const sortedLatencies = [...latencies].sort((left, right) => left - right);
  const passed = results.filter((result) => result.passed).length;
  const output = {
    schema_version: 1,
    benchmark: "001-post-users",
    target: options.target,
    run_kind: "engineering_baseline",
    correctness: {
      tests_passed: passed,
      tests_total: results.length,
      full_test_success: passed === results.length,
      tests: results,
    },
    artifact: {
      bytes: fs.statSync(options.wasm).size,
      sha256: sha256(options.wasm),
    },
    performance: {
      cold_start_ms: round(host.coldStartMilliseconds),
      mean_request_ms: round(mean(latencies)),
      median_request_ms: round(percentile(sortedLatencies, 0.5)),
      p95_request_ms: round(percentile(sortedLatencies, 0.95)),
      throughput_requests_per_second: round(
        throughputRequests / (throughputMilliseconds / 1_000),
      ),
      peak_memory_bytes: parsePeakMemory(host.standardError()),
      user_cpu_seconds: parseCpu(host.standardError(), "user"),
      system_cpu_seconds: parseCpu(host.standardError(), "sys"),
      latency_samples_ms: latencies.map(round),
    },
  };
  writeResult(output);
  process.exitCode = output.correctness.full_test_success ? 0 : 1;
} finally {
  if (host.child.exitCode === null) host.child.kill("SIGTERM");
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function test(name, action) {
  try {
    await action();
    results.push({ name, passed: true, failure: null });
  } catch (error) {
    results.push({ name, passed: false, failure: String(error?.message ?? error) });
  }
}

async function startHost({ database, maxRequests, storageUnavailable = false }) {
  const commandArguments = [
    "-l",
    options.host,
    "serve",
    "--wasm",
    options.wasm,
    "--db",
    database,
    "--port",
    "0",
    "--max-requests",
    String(maxRequests),
  ];
  if (storageUnavailable) commandArguments.push("--storage-unavailable");
  const start = performance.now();
  const child = spawn("/usr/bin/time", commandArguments, { stdio: ["ignore", "pipe", "pipe"] });
  let standardError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    standardError += chunk;
  });
  const origin = await waitForOrigin(child, () => standardError);
  return {
    child,
    origin,
    coldStartMilliseconds: performance.now() - start,
    standardError: () => standardError,
  };
}

function waitForOrigin(child, standardError) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`shared host did not start: ${standardError()}`)),
      30_000,
    );
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
      reject(new Error(`shared host exited before listening with ${code}: ${standardError()}`));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timeout = setTimeout(() => reject(new Error("shared host did not exit")), 30_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function jsonRequest(origin, value) {
  return rawRequest(origin, JSON.stringify(value));
}

async function rawRequest(origin, body) {
  const response = await fetch(`${origin}/users`, {
    method: "POST",
    headers: {
      "connection": "close",
      "content-type": "application/json",
    },
    body,
  });
  return { status: response.status, body: await response.json() };
}

function parsePeakMemory(output) {
  const match = output.match(/(\d+)\s+maximum resident set size/);
  return match ? Number(match[1]) : null;
}

function parseCpu(output, kind) {
  const match = output.match(new RegExp(`([0-9.]+)\\s+${kind}`));
  return match ? Number(match[1]) : null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sorted, proportion) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * proportion))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function writeResult(result) {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, json);
  }
  process.stdout.write(json);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
  }
  for (const flag of ["--host", "--wasm", "--target"]) {
    if (!values.has(flag)) throw new Error(`missing ${flag}`);
  }
  return {
    host: path.resolve(values.get("--host")),
    wasm: path.resolve(values.get("--wasm")),
    target: values.get("--target"),
    output: values.get("--output") ?? null,
  };
}
