import crypto from "node:crypto";
import fs from "node:fs";

const topLevelKeys = [
  "application",
  "capabilities",
  "dependencies",
  "effects",
  "endpoint",
  "input",
  "invariants",
  "kind",
  "outcomes",
  "postconditions",
  "resources",
  "schema_version",
];

const knownPredicates = new Set(["non_empty", "air_email_v1", "positive_integer"]);
const knownPostconditions = new Set([
  "response_field",
  "database_row_matches_response_id",
]);
const knownInvariants = new Set(["unique"]);
const knownCapabilityKinds = new Set(["sqlite_insert"]);

export function readContract(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`AIR contract is not valid JSON: ${error.message}`);
  }
  validateContract(value);
  return value;
}

export function validateContract(contract) {
  object(contract, "contract");
  exactKeys(contract, topLevelKeys, "contract");
  equal(contract.schema_version, 1, "schema_version must be 1");
  equal(contract.kind, "air.contract", "kind must be air.contract");

  object(contract.application, "application");
  exactKeys(contract.application, ["id"], "application");
  nonEmptyString(contract.application.id, "application.id");
  object(contract.endpoint, "endpoint");
  exactKeys(contract.endpoint, ["content_type", "method", "path"], "endpoint");
  equal(contract.endpoint.method, "POST", "only POST is supported by prototype v1");
  stringStartingWith(contract.endpoint.path, "/", "endpoint.path");
  equal(
    contract.endpoint.content_type,
    "application/json",
    "only application/json is supported by prototype v1",
  );

  object(contract.input, "input");
  exactKeys(
    contract.input,
    ["body_max_bytes", "fields", "invalid_shape_outcome", "kind"],
    "input",
  );
  equal(contract.input.kind, "closed_object", "input.kind must be closed_object");
  positiveInteger(contract.input.body_max_bytes, "input.body_max_bytes");
  object(contract.input.fields, "input.fields");
  const fieldNames = Object.keys(contract.input.fields);
  if (fieldNames.length === 0) throw new Error("input.fields must not be empty");
  for (const [name, field] of Object.entries(contract.input.fields)) {
    object(field, `input.fields.${name}`);
    exactKeys(
      field,
      ["invalid_outcome", "predicates", "required", "type"],
      `input.fields.${name}`,
    );
    equal(field.type, "string", `input.fields.${name}.type must be string`);
    equal(field.required, true, `input.fields.${name}.required must be true`);
    array(field.predicates, `input.fields.${name}.predicates`);
    for (const predicate of field.predicates) {
      if (!knownPredicates.has(predicate)) {
        throw new Error(`unsupported predicate ${predicate} on input field ${name}`);
      }
    }
    outcomeExists(contract, field.invalid_outcome, `input.fields.${name}.invalid_outcome`);
  }
  outcomeExists(contract, contract.input.invalid_shape_outcome, "input.invalid_shape_outcome");

  object(contract.outcomes, "outcomes");
  if (!contract.outcomes.success) throw new Error("outcomes.success is required");
  for (const [name, outcome] of Object.entries(contract.outcomes)) {
    object(outcome, `outcomes.${name}`);
    exactKeys(outcome, ["body", "status"], `outcomes.${name}`);
    integerBetween(outcome.status, 100, 599, `outcomes.${name}.status`);
    object(outcome.body, `outcomes.${name}.body`);
    if (name === "success") {
      exactKeys(outcome.body, ["fields", "kind"], `outcomes.${name}.body`);
      equal(outcome.body.kind, "closed_object", "success body must be a closed_object");
      object(outcome.body.fields, "outcomes.success.body.fields");
      for (const [fieldName, field] of Object.entries(outcome.body.fields)) {
        object(field, `outcomes.success.body.fields.${fieldName}`);
        exactKeys(field, ["required", "type"], `outcomes.success.body.fields.${fieldName}`);
        equal(field.required, true, `success body field ${fieldName} must be required`);
        if (!knownPredicates.has(field.type)) {
          throw new Error(`unsupported success body field type ${field.type}`);
        }
      }
    } else {
      exactKeys(outcome.body, ["error"], `outcomes.${name}.body`);
      nonEmptyString(outcome.body.error, `outcomes.${name}.body.error`);
    }
  }

  array(contract.effects, "effects");
  const effectIds = new Set();
  for (const effect of contract.effects) {
    object(effect, "effect");
    exactKeys(
      effect,
      ["columns", "database", "id", "kind", "on_duplicate", "on_unavailable", "table"],
      `effect ${effect.id ?? "unknown"}`,
    );
    nonEmptyString(effect.id, "effect.id");
    if (effectIds.has(effect.id)) throw new Error(`duplicate effect id ${effect.id}`);
    effectIds.add(effect.id);
    equal(effect.kind, "sqlite_insert", `effect ${effect.id} has unsupported kind`);
    nonEmptyString(effect.database, `effect ${effect.id}.database`);
    nonEmptyString(effect.table, `effect ${effect.id}.table`);
    stringArray(effect.columns, `effect ${effect.id}.columns`);
    outcomeExists(contract, effect.on_duplicate, `effect ${effect.id}.on_duplicate`);
    outcomeExists(contract, effect.on_unavailable, `effect ${effect.id}.on_unavailable`);
  }

  array(contract.postconditions, "postconditions");
  for (const postcondition of contract.postconditions) {
    object(postcondition, "postcondition");
    if (!knownPostconditions.has(postcondition.kind)) {
      throw new Error(`unsupported postcondition kind ${postcondition.kind}`);
    }
    if (postcondition.effect && !effectIds.has(postcondition.effect)) {
      throw new Error(`postcondition references unknown effect ${postcondition.effect}`);
    }
    if (postcondition.predicate && !knownPredicates.has(postcondition.predicate)) {
      throw new Error(`unsupported postcondition predicate ${postcondition.predicate}`);
    }
    if (postcondition.kind === "response_field") {
      exactKeys(
        postcondition,
        ["field", "kind", "outcome", "predicate"],
        "response_field postcondition",
      );
      outcomeExists(contract, postcondition.outcome, "response_field postcondition outcome");
    } else {
      exactKeys(
        postcondition,
        ["effect", "input_to_columns", "kind", "response_field"],
        "database postcondition",
      );
      object(postcondition.input_to_columns, "database postcondition input_to_columns");
    }
  }

  array(contract.invariants, "invariants");
  for (const invariant of contract.invariants) {
    object(invariant, "invariant");
    exactKeys(
      invariant,
      ["columns", "effect", "kind", "violation_outcome"],
      "invariant",
    );
    if (!knownInvariants.has(invariant.kind)) {
      throw new Error(`unsupported invariant kind ${invariant.kind}`);
    }
    if (!effectIds.has(invariant.effect)) {
      throw new Error(`invariant references unknown effect ${invariant.effect}`);
    }
    stringArray(invariant.columns, "invariant.columns");
    outcomeExists(contract, invariant.violation_outcome, "invariant.violation_outcome");
  }

  object(contract.capabilities, "capabilities");
  exactKeys(contract.capabilities, ["allowed", "forbidden"], "capabilities");
  array(contract.capabilities.allowed, "capabilities.allowed");
  stringArray(contract.capabilities.forbidden, "capabilities.forbidden");
  for (const capability of contract.capabilities.allowed) {
    object(capability, "capability");
    exactKeys(
      capability,
      ["columns", "database", "id", "kind", "table", "wasm_import"],
      `capability ${capability.id ?? "unknown"}`,
    );
    nonEmptyString(capability.id, "capability.id");
    if (!knownCapabilityKinds.has(capability.kind)) {
      throw new Error(`unsupported capability kind ${capability.kind}`);
    }
    object(capability.wasm_import, `capability ${capability.id}.wasm_import`);
    exactKeys(
      capability.wasm_import,
      ["module", "name", "parameters", "results"],
      `capability ${capability.id}.wasm_import`,
    );
    nonEmptyString(capability.wasm_import.module, `capability ${capability.id} import module`);
    nonEmptyString(capability.wasm_import.name, `capability ${capability.id} import name`);
    stringArray(capability.wasm_import.parameters, `capability ${capability.id} parameters`);
    stringArray(capability.wasm_import.results, `capability ${capability.id} results`);
    const matchingEffect = contract.effects.some(
      (effect) =>
        effect.kind === capability.kind &&
        effect.database === capability.database &&
        effect.table === capability.table &&
        sameValues(effect.columns, capability.columns),
    );
    if (!matchingEffect) {
      throw new Error(`capability ${capability.id} has no matching declared effect`);
    }
  }

  object(contract.dependencies, "dependencies");
  exactKeys(
    contract.dependencies,
    ["build_scripts", "maximum_direct", "maximum_graph_depth", "maximum_transitive"],
    "dependencies",
  );
  nonNegativeInteger(contract.dependencies.maximum_direct, "dependencies.maximum_direct");
  nonNegativeInteger(contract.dependencies.maximum_transitive, "dependencies.maximum_transitive");
  nonNegativeInteger(contract.dependencies.maximum_graph_depth, "dependencies.maximum_graph_depth");
  equal(contract.dependencies.build_scripts, false, "build scripts are unsupported");

  object(contract.resources, "resources");
  const resourceNames = [
    "guest_memory_bytes",
    "fuel_per_request",
    "maximum_instances",
    "maximum_memories",
    "maximum_tables",
    "maximum_table_elements",
  ];
  exactKeys(contract.resources, resourceNames, "resources");
  for (const name of resourceNames) {
    positiveInteger(contract.resources[name], `resources.${name}`);
  }
  return contract;
}

export function deriveCapabilityManifest(contract, contractBytes) {
  validateContract(contract);
  return {
    schema_version: 1,
    generated_from: "air.contract",
    source_contract_sha256: crypto.createHash("sha256").update(contractBytes).digest("hex"),
    allowed_imports: contract.capabilities.allowed.map((capability) => ({
      capability: capability.id,
      module: capability.wasm_import.module,
      name: capability.wasm_import.name,
      parameters: capability.wasm_import.parameters,
      results: capability.wasm_import.results,
      resource: {
        kind: capability.kind,
        database: capability.database,
        table: capability.table,
        columns: capability.columns,
      },
    })),
    denied_categories: [...contract.capabilities.forbidden],
    resources: { ...contract.resources },
  };
}

export function deriveChecks(contract) {
  validateContract(contract);
  const checks = [];
  const invalidShape = contract.outcomes[contract.input.invalid_shape_outcome];
  for (const [fieldName, field] of Object.entries(contract.input.fields)) {
    if (field.required) {
      checks.push({
        id: `required-${fieldName}`,
        class: "dynamic",
        generator: "omit_required_field",
        field: fieldName,
        expected: responseExpectation(invalidShape),
      });
    }
    for (const predicate of field.predicates) {
      const outcome = contract.outcomes[field.invalid_outcome];
      checks.push({
        id: `predicate-${fieldName}-${predicate}`,
        class: "dynamic",
        generator: "predicate_counterexamples",
        field: fieldName,
        predicate,
        expected: responseExpectation(outcome),
      });
    }
  }
  checks.push({
    id: "closed-input-object",
    class: "dynamic",
    generator: "add_unknown_field",
    expected: responseExpectation(invalidShape),
  });
  checks.push({
    id: "body-size-limit",
    class: "dynamic",
    generator: "exceed_body_limit",
    maximum_bytes: contract.input.body_max_bytes,
    expected: responseExpectation(invalidShape),
  });
  checks.push({
    id: "success-outcome",
    class: "dynamic",
    generator: "valid_input",
    expected: responseExpectation(contract.outcomes.success),
  });
  for (const postcondition of contract.postconditions) {
    checks.push({
      id: `postcondition-${postcondition.kind}`,
      class: "dynamic",
      generator: postcondition.kind,
      rule: postcondition,
    });
  }
  for (const invariant of contract.invariants) {
    checks.push({
      id: `invariant-${invariant.kind}-${invariant.columns.join("-")}`,
      class: "dynamic",
      generator: invariant.kind,
      rule: invariant,
      expected: responseExpectation(contract.outcomes[invariant.violation_outcome]),
    });
  }
  for (const effect of contract.effects) {
    checks.push({
      id: `effect-unavailable-${effect.id}`,
      class: "dynamic",
      generator: "capability_unavailable",
      effect: effect.id,
      expected: responseExpectation(contract.outcomes[effect.on_unavailable]),
    });
  }
  checks.push({
    id: "wasm-import-allowlist",
    class: "static",
    generator: "capability_manifest",
  });
  checks.push({
    id: "dependency-limits",
    class: "static",
    generator: "cargo_metadata",
    limits: { ...contract.dependencies },
  });
  return {
    schema_version: 1,
    generated_from: "air.contract",
    runtime: {
      endpoint: { ...contract.endpoint },
      body_max_bytes: contract.input.body_max_bytes,
      input_fields: Object.keys(contract.input.fields),
      valid_input: Object.fromEntries(
        Object.entries(contract.input.fields).map(([name, field]) => [
          name,
          validValue(name, field.predicates),
        ]),
      ),
      outcomes: contract.outcomes,
      effects: contract.effects,
    },
    checks,
  };
}

export const predicateCounterexamples = {
  non_empty: [""],
  air_email_v1: [
    "not-an-email",
    "a@b",
    "a@@b.co",
    "alice @example.com",
    "a@.bc",
    "a@bc.",
  ],
};

function responseExpectation(outcome) {
  return { status: outcome.status, body: outcome.body };
}

function validValue(name, predicates) {
  if (predicates.includes("air_email_v1")) return `${name}@example.test`;
  if (predicates.includes("non_empty")) return `Valid ${name}`;
  return `Valid ${name}`;
}

function outcomeExists(contract, value, label) {
  nonEmptyString(value, label);
  if (!contract.outcomes?.[value]) throw new Error(`${label} references unknown outcome ${value}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function stringArray(value, label) {
  array(value, label);
  for (const item of value) nonEmptyString(item, label);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function stringStartingWith(value, prefix, label) {
  nonEmptyString(value, label);
  if (!value.startsWith(prefix)) throw new Error(`${label} must start with ${prefix}`);
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
}

function integerBetween(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameValues(actual, wanted)) {
    throw new Error(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
