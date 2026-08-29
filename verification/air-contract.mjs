import fs from "node:fs";
import path from "node:path";
import {
  deriveCapabilityManifest,
  deriveChecks,
  readContract,
} from "./contract.mjs";

const [command, contractArgument, outputFlag, outputArgument] = process.argv.slice(2);
if (!command || !contractArgument) {
  throw new Error("usage: node verification/air-contract.mjs <check|manifest|checks> contract.json [--output file]");
}
if ((outputFlag || outputArgument) && (outputFlag !== "--output" || !outputArgument)) {
  throw new Error("output must be provided as --output file");
}

const contractFile = path.resolve(contractArgument);
const contractBytes = fs.readFileSync(contractFile);
const contract = readContract(contractFile);
let value;
switch (command) {
  case "check":
    value = {
      valid: true,
      application: contract.application.id,
      static_rules: deriveChecks(contract).checks.filter((check) => check.class === "static").length,
      dynamic_rules: deriveChecks(contract).checks.filter((check) => check.class === "dynamic").length,
    };
    break;
  case "manifest":
    value = deriveCapabilityManifest(contract, contractBytes);
    break;
  case "checks":
    value = deriveChecks(contract);
    break;
  default:
    throw new Error(`unknown command ${command}`);
}

const json = `${JSON.stringify(value, null, 2)}\n`;
if (outputArgument) {
  const output = path.resolve(outputArgument);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, json);
} else {
  process.stdout.write(json);
}
