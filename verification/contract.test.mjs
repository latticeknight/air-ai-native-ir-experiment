import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  deriveCapabilityManifest,
  deriveChecks,
  readContract,
  validateContract,
} from "./contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const contractFile = path.join(root, "benchmarks/001-post-users/verification/air.contract.json");
const bytes = fs.readFileSync(contractFile);
const contract = readContract(contractFile);

assert.equal(validateContract(contract), contract);
const manifest = deriveCapabilityManifest(contract, bytes);
assert.deepEqual(
  manifest.allowed_imports.map(({ module, name }) => ({ module, name })),
  [{ module: "air_sqlite_v1", name: "insert_user" }],
);
assert.equal(manifest.resources.guest_memory_bytes, 4_194_304);

const plan = deriveChecks(contract);
assert.equal(plan.checks.filter((check) => check.class === "static").length, 2);
assert.equal(plan.checks.filter((check) => check.class === "dynamic").length, 11);
assert.ok(plan.checks.some((check) => check.generator === "database_row_matches_response_id"));
assert.ok(plan.checks.some((check) => check.generator === "cargo_metadata"));

rejects((value) => { value.unrecognised = true; }, "contract keys must be exactly");
rejects(
  (value) => { value.input.fields.email.predicates = ["arbitrary_expression"]; },
  "unsupported predicate",
);
rejects(
  (value) => { value.capabilities.allowed[0].table = "secrets"; },
  "has no matching declared effect",
);
rejects(
  (value) => { value.dependencies.maximum_direct = -1; },
  "must be a non-negative integer",
);

process.stdout.write("AIR contract validation tests passed\n");

function rejects(mutate, pattern) {
  const value = structuredClone(contract);
  mutate(value);
  assert.throws(() => validateContract(value), new RegExp(pattern));
}
