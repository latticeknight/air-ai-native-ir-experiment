import assert from "node:assert/strict";
import { allStates, protocol, stateAt } from "./state.mjs";

const states = allStates();
assert.equal(states.length, 20);
assert.equal(protocol.chains_per_pipeline, 5);
assert.deepEqual(stateAt(1).active_capabilities, ["users.insert"]);
assert.ok(stateAt(7).active_capabilities.includes("users.update_email"));
assert.ok(stateAt(8).active_capabilities.includes("audit.append_email_change"));
assert.ok(!stateAt(10).active_capabilities.includes("users.update_email"));
assert.ok(!stateAt(10).active_capabilities.includes("audit.append_email_change"));
assert.ok(stateAt(10).revoked_capabilities.includes("users.update_email"));
assert.ok(stateAt(10).retired_requirements.includes("LD-007-admin-email-update"));
assert.ok(stateAt(18).retired_requirements.includes("LD-002-name-length-1-100"));
assert.ok(stateAt(18).active_requirements.includes("LD-018-name-length-2-80"));
assert.deepEqual(stateAt(20).routes, [
  "DELETE /users/{id}",
  "GET /health",
  "GET /users/{id}",
  "PATCH /users/{id}",
  "PATCH /users/{id}/status",
  "POST /users",
  "PUT /users/{id}/profile",
]);
assert.deepEqual(stateAt(20).public_user_fields, ["email", "id", "name", "status", "verified"]);

process.stdout.write("longitudinal active-requirement oracle state tests passed\n");
