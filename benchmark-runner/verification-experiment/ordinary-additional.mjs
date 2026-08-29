import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const options = parseArguments(process.argv.slice(2));
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ordinary-additional-tests-"));
const invalidEmails = [
  "a@b",
  "a@@b.co",
  "alice @example.com",
  "a@.bc",
  "a@bc.",
];
const results = [];

try {
  const host = await startHost(path.join(temporaryDirectory, "users.sqlite"), invalidEmails.length);
  try {
    for (const [index, email] of invalidEmails.entries()) {
      try {
        const response = await fetch(`${host.origin}/users`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: `Invalid ${index}`, email }),
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.deepEqual(body, { error: "invalid_email" });
        results.push({ email, passed: true, failure: null });
      } catch (error) {
        results.push({ email, passed: false, failure: String(error?.message ?? error) });
      }
    }
    const exit = await waitForExit(host.child);
    assert.equal(exit.code, 0, host.standardError());
  } finally {
    if (host.child.exitCode === null) host.child.kill("SIGTERM");
  }
  const output = {
    schema_version: 1,
    kind: "ordinary_hand_written_integration_tests",
    tests_passed: results.filter((result) => result.passed).length,
    tests_total: results.length,
    full_success: results.every((result) => result.passed),
    tests: results,
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) fs.writeFileSync(options.output, json);
  else process.stdout.write(json);
  process.exitCode = output.full_success ? 0 : 1;
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function startHost(database, maxRequests) {
  const child = spawn(
    options.host,
    [
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
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let standardError = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { standardError += chunk; });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`host did not start: ${standardError}`)), 10_000);
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
      reject(new Error(`host exited before listening with ${code}: ${standardError}`));
    });
  });
  return { child, origin, standardError: () => standardError };
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    values.set(arguments_[index], arguments_[index + 1]);
  }
  for (const name of ["--host", "--wasm", "--manifest"]) {
    if (!values.get(name)) throw new Error(`missing ${name}`);
  }
  return {
    host: path.resolve(values.get("--host")),
    wasm: path.resolve(values.get("--wasm")),
    manifest: path.resolve(values.get("--manifest")),
    output: values.get("--output") ? path.resolve(values.get("--output")) : null,
  };
}
