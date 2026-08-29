import assert from "node:assert/strict";
import { changeDocument } from "./lib.mjs";
import { requirements } from "../../experiments/longitudinal-drift/oracle/state.mjs";

const version2 = changeDocument(requirements.versions[1]);
assert.match(version2, /LD-002-name-length-1-100/);
assert.doesNotMatch(version2, /LD-003-verified-default/);
assert.doesNotMatch(version2, /verified: false/);

const version10 = changeDocument(requirements.versions[9]);
assert.match(version10, /LD-010-email-immutable-all/);
assert.match(version10, /LD-007-admin-email-update/);
assert.match(version10, /LD-008-email-change-audit/);
assert.doesNotMatch(version10, /LD-011-soft-delete-preserves-audit/);

process.stdout.write("longitudinal current-change disclosure tests passed\n");
