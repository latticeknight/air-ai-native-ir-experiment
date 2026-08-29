import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArguments(process.argv.slice(2));
const source = fs.readFileSync(options.airSource, "utf8");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "air-security-"));

const attacks = [
  {
    id: "read-etc-passwd",
    sourceMutation: replaceRequiredCapability("air:http/server@1", "air:filesystem/read@1"),
  },
  {
    id: "arbitrary-filesystem-read",
    sourceMutation: replaceRequiredCapability("air:http/server@1", "air:filesystem/read@1"),
  },
  {
    id: "arbitrary-filesystem-write",
    sourceMutation: replaceRequiredCapability("air:http/server@1", "air:filesystem/write@1"),
  },
  {
    id: "environment-variable-access",
    sourceMutation: addEffect("air:environment/read@1"),
  },
  {
    id: "outbound-http",
    sourceMutation: replaceRequiredCapability("air:http/server@1", "air:http/client@1"),
  },
  {
    id: "undeclared-sqlite-table",
    sourceMutation: (value) => value.replace('table "users"', 'table "secrets"'),
  },
  {
    id: "undeclared-database",
    sourceMutation: replaceRequiredCapability(
      "air:sqlite/users.insert@1",
      "air:sqlite/other.insert@1",
    ),
  },
  {
    id: "undeclared-capability",
    sourceMutation: addEffect("air:sqlite/users.delete@1"),
  },
];

try {
  const baseline = inspect(options.wasm);
  if (baseline.status !== 0) {
    throw new Error(`candidate baseline was rejected: ${baseline.stderr}`);
  }

  const observations = attacks.map((attack) => {
    const fixture = path.join(options.attacksDirectory, `${attack.id}.wat`);
    const boundary = inspect(fixture);
    const boundaryBlocked = boundary.status !== 0;
    const observation = {
      attack: attack.id,
      attempted: true,
      successful_undeclared_access: !boundaryBlocked,
      blocked_stage: boundaryBlocked ? "runtime_capability_boundary" : "not_stopped",
      runtime_boundary_probe: {
        fixture: path.relative(options.root, fixture),
        rejected: boundaryBlocked,
        diagnostic: clean(boundary.stderr || boundary.stdout),
      },
    };

    if (options.target === "air") {
      const maliciousSource = path.join(temporaryDirectory, `${attack.id}.air`);
      fs.writeFileSync(maliciousSource, attack.sourceMutation(source));
      const check = spawnSync(options.airCompiler, ["check", maliciousSource], {
        encoding: "utf8",
      });
      const sourceBlocked = check.status !== 0;
      observation.air_source_probe = {
        rejected: sourceBlocked,
        diagnostic: clean(check.stderr || check.stdout),
      };
      if (sourceBlocked) {
        observation.blocked_stage = "air_verification";
        observation.successful_undeclared_access = false;
      }
    }

    return observation;
  });

  const output = {
    schema_version: 1,
    benchmark: "001-post-users",
    target: options.target,
    run_kind: "engineering_baseline",
    methodology: {
      candidate_baseline_checked: true,
      source_attack_probe:
        options.target === "air"
          ? "Mutated AIR source was checked by the frozen AIR verifier."
          : "Not run because a generated Rust source attack corpus is outside this baseline.",
      runtime_attack_probe:
        "Synthetic Wasm modules requested one forbidden import and were inspected by the shared host.",
    },
    security: {
      undeclared_access_attempts: observations.length,
      undeclared_access_successes: observations.filter(
        (observation) => observation.successful_undeclared_access,
      ).length,
      attacks: observations,
    },
  };

  writeResult(output);
  process.exitCode = output.security.undeclared_access_successes === 0 ? 0 : 1;
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function replaceRequiredCapability(from, to) {
  return (value) => value.replaceAll(from, to);
}

function addEffect(capability) {
  return (value) =>
    value.replace(
      "  air:sqlite/users.insert@1;\n}\nrequires",
      `  air:sqlite/users.insert@1;\n  ${capability};\n}\nrequires`,
    );
}

function inspect(wasm) {
  return spawnSync(options.host, ["inspect", "--wasm", wasm], { encoding: "utf8" });
}

function clean(value) {
  return value.trim().replaceAll(options.root, ".").replaceAll(temporaryDirectory, "<temporary>");
}

function writeResult(result) {
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, json);
  }
  process.stdout.write(json);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    values.set(arguments_[index], arguments_[index + 1]);
  }
  for (const flag of ["--host", "--wasm", "--target", "--air-source", "--air-compiler", "--attacks"]) {
    if (!values.get(flag)) throw new Error(`missing ${flag}`);
  }
  const root = process.cwd();
  return {
    root,
    host: path.resolve(values.get("--host")),
    wasm: path.resolve(values.get("--wasm")),
    target: values.get("--target"),
    airSource: path.resolve(values.get("--air-source")),
    airCompiler: path.resolve(values.get("--air-compiler")),
    attacksDirectory: path.resolve(values.get("--attacks")),
    output: values.get("--output") ? path.resolve(values.get("--output")) : null,
  };
}
