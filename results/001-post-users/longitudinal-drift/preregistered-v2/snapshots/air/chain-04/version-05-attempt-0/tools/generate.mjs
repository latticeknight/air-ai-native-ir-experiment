import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const contractFile = path.join(root, "air.contract.json");
const contractBytes = fs.readFileSync(contractFile);
const contract = JSON.parse(contractBytes);
validate(contract);
const digest = crypto.createHash("sha256").update(contractBytes).digest("hex");
const output = path.join(root, "generated");
fs.mkdirSync(output, { recursive: true });

write("capability-policy.json", {
  schema_version: 1,
  contract_sha256: digest,
  allowed_imports: contract.capabilities
    .map(({ module, name }) => ({ module, name }))
    .sort(compareImports),
  resources: contract.resources,
});
write("dependency-policy.json", {
  schema_version: 1,
  contract_sha256: digest,
  ...contract.dependencies,
});
write("visible-cases.json", {
  schema_version: 1,
  contract_sha256: digest,
  requirements: [...contract.requirements.active].sort(),
});
write("openapi.json", openApi(contract, digest));
write("verification-metadata.json", {
  schema_version: 1,
  contract_sha256: digest,
  contract_version: contract.version,
  active_requirements: [...contract.requirements.active].sort(),
  retired_requirements: [...contract.requirements.retired].sort(),
  route_count: contract.routes.length,
  capability_count: contract.capabilities.length,
  public_user_fields: [...contract.public_user_fields].sort(),
});

function validate(value) {
  if (value.schema_version !== 1 || value.benchmark !== "001-post-users") {
    throw new Error("unsupported AIR contract");
  }
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > 20) {
    throw new Error("contract version must be between 1 and 20");
  }
  for (const field of ["active", "retired"]) {
    if (!Array.isArray(value.requirements?.[field])) throw new Error(`requirements.${field} must be an array`);
  }
  for (const field of ["routes", "public_user_fields", "capabilities", "invariants"]) {
    if (!Array.isArray(value[field])) throw new Error(`${field} must be an array`);
  }
  const imports = new Set();
  for (const capability of value.capabilities) {
    const key = `${capability.module}.${capability.name}`;
    if (!capability.id || !capability.module || !capability.name || imports.has(key)) {
      throw new Error("capabilities must be flat, explicit, and unique");
    }
    imports.add(key);
  }
}

function openApi(value, contractSha256) {
  const paths = {};
  for (const route of value.routes) {
    const key = route.path.replaceAll("{id}", "{id}");
    paths[key] ??= {};
    paths[key][route.method.toLowerCase()] = {
      operationId: route.operation,
      responses: { "200": { description: "Contract-defined response" } },
    };
  }
  const properties = Object.fromEntries(
    value.public_user_fields.map((field) => [field, fieldSchema(field, value.validation)]),
  );
  return {
    openapi: "3.1.0",
    info: { title: "Benchmark 001 users API", version: String(value.version) },
    "x-air-contract-sha256": contractSha256,
    paths,
    components: {
      schemas: {
        PublicUser: {
          type: "object",
          required: [...value.public_user_fields],
          properties,
          additionalProperties: false,
        },
      },
    },
  };
}

function fieldSchema(field, validation) {
  if (field === "id") return { type: "integer", minimum: 1 };
  if (field === "verified") return { type: "boolean" };
  if (field === "status") return { type: "string", enum: ["active", "suspended"] };
  if (field === "email") return { type: "string", format: "email" };
  if (field === "name" && validation?.name) {
    return {
      type: "string",
      minLength: validation.name.minimum,
      ...(validation.name.maximum === null ? {} : { maxLength: validation.name.maximum }),
    };
  }
  return { type: "string" };
}

function compareImports(left, right) {
  return `${left.module}.${left.name}`.localeCompare(`${right.module}.${right.name}`);
}

function write(name, value) {
  fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
}
