import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const wasmPath = process.argv[2];
if (!wasmPath) {
  throw new Error("usage: node tests/service-e2e.mjs <service.wasm>");
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "air-service-e2e-"));
const databasePath = path.join(temporaryDirectory, "users.sqlite");
const runtimePath = path.resolve("runtime/http-sqlite-host.mjs");
const host = spawn(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    runtimePath,
    "--wasm",
    path.resolve(wasmPath),
    "--db",
    databasePath,
    "--port",
    "0",
    "--max-requests",
    "13",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let standardError = "";
host.stderr.setEncoding("utf8");
host.stderr.on("data", (chunk) => {
  standardError += chunk;
});

try {
  const origin = await waitForOrigin(host);

  const created = await request(origin, "POST", { name: "Ada", email: "ada@example.test" });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id: 1 });

  const invalidEmail = await request(origin, "POST", { name: "Ada", email: "not-an-email" });
  assert.equal(invalidEmail.status, 400);
  assert.deepEqual(invalidEmail.body, { error: "invalid_email" });

  const emptyDomainLabel = await request(origin, "POST", { name: "Ada", email: "a@.test" });
  assert.equal(emptyDomainLabel.status, 400);
  assert.deepEqual(emptyDomainLabel.body, { error: "invalid_email" });

  const secondAtSign = await request(origin, "POST", { name: "Ada", email: "a@@example.test" });
  assert.equal(secondAtSign.status, 400);
  assert.deepEqual(secondAtSign.body, { error: "invalid_email" });

  const emailWhitespace = await request(origin, "POST", { name: "Ada", email: "a b@example.test" });
  assert.equal(emailWhitespace.status, 400);
  assert.deepEqual(emailWhitespace.body, { error: "invalid_email" });

  const emptyName = await request(origin, "POST", { name: "", email: "nobody@example.test" });
  assert.equal(emptyName.status, 400);
  assert.deepEqual(emptyName.body, { error: "invalid_name" });

  const duplicate = await request(origin, "POST", { name: "Ada Again", email: "ada@example.test" });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { error: "duplicate_email" });

  const undeclaredField = await request(origin, "POST", {
    name: "Mallory",
    email: "mallory@example.test",
    read_file: "/etc/passwd",
  });
  assert.equal(undeclaredField.status, 400);
  assert.deepEqual(undeclaredField.body, { error: "invalid_json" });

  const missingField = await request(origin, "POST", { name: "Missing Email" });
  assert.equal(missingField.status, 400);
  assert.deepEqual(missingField.body, { error: "invalid_json" });

  const wrongType = await request(origin, "POST", { name: "Wrong Type", email: 42 });
  assert.equal(wrongType.status, 400);
  assert.deepEqual(wrongType.body, { error: "invalid_json" });

  const malformed = await fetch(`${origin}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_json" });

  const wrongMethod = await request(origin, "GET");
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(wrongMethod.body, { error: "method_not_allowed" });

  const wrongPath = await request(origin, "POST", { name: "No Route", email: "route@example.test" }, "/other");
  assert.equal(wrongPath.status, 404);
  assert.deepEqual(wrongPath.body, { error: "not_found" });

  const exitCode = await new Promise((resolve) => host.once("exit", resolve));
  assert.equal(exitCode, 0, standardError);

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const users = database
    .prepare("SELECT id, name, email FROM users ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  database.close();
  assert.deepEqual(users, [{ id: 1, name: "Ada", email: "ada@example.test" }]);
  console.log("service end-to-end test passed");
} finally {
  if (host.exitCode === null) host.kill("SIGTERM");
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function waitForOrigin(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`AIR host did not start: ${standardError}`)), 10_000);
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
      reject(new Error(`AIR host exited before listening with ${code}: ${standardError}`));
    });
  });
}

async function request(origin, method, body, pathname = "/users") {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
