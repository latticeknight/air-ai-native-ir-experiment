import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
export const experimentRoot = path.resolve(directory, "..");
export const repositoryRoot = path.resolve(experimentRoot, "../..");
export const requirementsFile = path.join(experimentRoot, "requirements.json");
export const protocolFile = path.join(experimentRoot, "protocol.json");
export const requirements = readJson(requirementsFile);
export const protocol = readJson(protocolFile);

validateSequence();

export function stateAt(version) {
  if (!Number.isInteger(version) || version < 1 || version > requirements.versions.length) {
    throw new Error(`version must be between 1 and ${requirements.versions.length}`);
  }
  const activeRequirements = new Set();
  const retiredRequirements = new Set();
  const activeCapabilities = new Set();
  const revokedCapabilities = new Set();
  const routes = new Set();
  const publicUserFields = new Set();
  const introducedAt = new Map();
  const retiredAt = new Map();

  for (const change of requirements.versions.slice(0, version)) {
    for (const id of change.activates) {
      activeRequirements.add(id);
      retiredRequirements.delete(id);
      if (!introducedAt.has(id)) introducedAt.set(id, change.version);
    }
    for (const id of change.retires) {
      activeRequirements.delete(id);
      retiredRequirements.add(id);
      retiredAt.set(id, change.version);
    }
    applyDelta(activeCapabilities, revokedCapabilities, change.capabilities);
    applySimpleDelta(routes, change.routes);
    applySimpleDelta(publicUserFields, change.public_user_fields);
  }

  return {
    version,
    change: requirements.versions[version - 1],
    active_requirements: [...activeRequirements].sort(),
    retired_requirements: [...retiredRequirements].sort(),
    active_capabilities: [...activeCapabilities].sort(),
    revoked_capabilities: [...revokedCapabilities].sort(),
    allowed_imports: [...activeCapabilities]
      .sort()
      .map((id) => ({ id, ...requirements.capability_catalog[id] })),
    routes: [...routes].sort(),
    public_user_fields: [...publicUserFields].sort(),
    introduced_at: Object.fromEntries([...introducedAt].sort()),
    retired_at: Object.fromEntries([...retiredAt].sort()),
  };
}

export function allStates() {
  return requirements.versions.map((change) => stateAt(change.version));
}

function applyDelta(active, revoked, delta) {
  for (const value of delta.add) {
    active.add(value);
    revoked.delete(value);
  }
  for (const value of delta.remove) {
    active.delete(value);
    revoked.add(value);
  }
}

function applySimpleDelta(values, delta) {
  for (const value of delta.add) values.add(value);
  for (const value of delta.remove) values.delete(value);
}

function validateSequence() {
  if (requirements.benchmark !== "001-post-users") {
    throw new Error("longitudinal experiment must remain Benchmark 001");
  }
  if (requirements.versions.length !== protocol.versions_per_chain) {
    throw new Error("requirements and protocol version counts differ");
  }
  const active = new Set();
  const capabilities = new Set();
  const knownRequirementIds = new Set();
  for (const [index, change] of requirements.versions.entries()) {
    if (change.version !== index + 1) throw new Error("versions must be contiguous and ordered");
    if (change.id !== `EV-${String(change.version).padStart(3, "0")}`) {
      throw new Error(`unexpected evolution identifier ${change.id}`);
    }
    for (const id of change.activates) {
      if (active.has(id)) throw new Error(`requirement ${id} is already active`);
      active.add(id);
      knownRequirementIds.add(id);
    }
    for (const id of change.retires) {
      if (!active.delete(id)) throw new Error(`cannot retire inactive requirement ${id}`);
    }
    for (const id of change.capabilities.add) {
      if (!requirements.capability_catalog[id]) throw new Error(`unknown capability ${id}`);
      if (capabilities.has(id)) throw new Error(`capability ${id} is already active`);
      capabilities.add(id);
    }
    for (const id of change.capabilities.remove) {
      if (!capabilities.delete(id)) throw new Error(`cannot revoke inactive capability ${id}`);
    }
  }
  if (knownRequirementIds.size < 20) {
    throw new Error("the sequence must contain at least 20 independently tracked requirement groups");
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
