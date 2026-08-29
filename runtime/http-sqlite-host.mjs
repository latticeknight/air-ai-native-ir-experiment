import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const options = parseArguments(process.argv.slice(2));
const wasmBytes = fs.readFileSync(options.wasm);
const wasmModule = new WebAssembly.Module(wasmBytes);

verifyModuleShape(wasmModule);
verifyMetadata(wasmModule);

fs.mkdirSync(path.dirname(path.resolve(options.db)), { recursive: true });
const database = new DatabaseSync(options.db);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  );
`);
const insertUser = database.prepare("INSERT INTO users (name, email) VALUES (?, ?)");

let instance;
const imports = {
  air_sqlite_v1: {
    insert_user(namePointer, nameLength, emailPointer, emailLength) {
      try {
        const name = readUtf8(namePointer, nameLength);
        const email = readUtf8(emailPointer, emailLength);
        const result = insertUser.run(name, email);
        return BigInt(result.lastInsertRowid);
      } catch (error) {
        if (String(error?.message).includes("UNIQUE constraint failed: users.email")) {
          return -4n;
        }
        console.error("AIR SQLite capability failed:", error);
        return -3n;
      }
    },
  },
};

instance = await WebAssembly.instantiate(wasmModule, imports);

let handledRequests = 0;
const server = http.createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error("AIR request host failed:", error);
    sendJson(response, 500, { error: "storage_failure" });
  } finally {
    handledRequests += 1;
    if (options.maxRequests !== null && handledRequests >= options.maxRequests) {
      server.close(() => {
        database.close();
      });
    }
  }
});

server.listen(options.port, options.host, () => {
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("AIR host did not receive a TCP address");
  }
  console.log(`listening http://${options.host}:${address.port}`);
});

async function handleRequest(request, response) {
  if (request.url !== "/users") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }

  let body;
  try {
    body = await readRequestBody(request, 32_768);
  } catch {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }

  if (!isCreateUserInput(input)) {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }

  const encoder = new TextEncoder();
  const name = encoder.encode(input.name);
  const email = encoder.encode(input.email);
  if (name.length + email.length > 60_000) {
    sendJson(response, 400, { error: "invalid_json" });
    return;
  }

  const namePointer = 1_024;
  const emailPointer = namePointer + name.length;
  const memory = new Uint8Array(instance.exports.memory.buffer);
  memory.set(name, namePointer);
  memory.set(email, emailPointer);

  const result = instance.exports.handle_create_user(
    namePointer,
    name.length,
    emailPointer,
    email.length,
  );
  if (result > 0n) {
    sendJson(response, 201, { id: Number(result) });
    return;
  }

  const errors = new Map([
    [-1n, [400, "invalid_name"]],
    [-2n, [400, "invalid_email"]],
    [-4n, [409, "duplicate_email"]],
  ]);
  const [status, error] = errors.get(result) ?? [500, "storage_failure"];
  sendJson(response, status, { error });
}

function isCreateUserInput(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "email" &&
    keys[1] === "name" &&
    typeof value.name === "string" &&
    typeof value.email === "string"
  );
}

function readUtf8(pointer, length) {
  const memory = new Uint8Array(instance.exports.memory.buffer);
  if (pointer < 0 || length < 0 || pointer + length > memory.length) {
    throw new Error("AIR module supplied an out-of-bounds string");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(memory.subarray(pointer, pointer + length));
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(new Error("request body exceeds AIR host limit"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function verifyModuleShape(module) {
  const imports = WebAssembly.Module.imports(module);
  if (
    imports.length !== 1 ||
    imports[0].module !== "air_sqlite_v1" ||
    imports[0].name !== "insert_user" ||
    imports[0].kind !== "function"
  ) {
    throw new Error("AIR service module requested an import outside its runtime grant");
  }
}

function verifyMetadata(module) {
  const sections = WebAssembly.Module.customSections(module, "air.meta");
  if (sections.length !== 1) {
    throw new Error("AIR service module must contain exactly one metadata section");
  }
  const metadata = Object.fromEntries(
    new TextDecoder()
      .decode(sections[0])
      .trim()
      .split("\n")
      .map((line) => line.split("=", 2)),
  );
  const expectedCapabilities = [
    "air:http/server@1",
    "air:json@1",
    "air:sqlite/users.insert@1",
  ];
  const actualCapabilities = (metadata.capabilities ?? "").split(",").sort();
  if (
    metadata.format !== "air-meta-v1" ||
    metadata.kind !== "http-service" ||
    JSON.stringify(actualCapabilities) !== JSON.stringify(expectedCapabilities)
  ) {
    throw new Error("AIR metadata does not match the reference host grant");
  }
}

function parseArguments(arguments_) {
  const parsed = {
    wasm: null,
    db: "target/air/users.sqlite",
    host: "127.0.0.1",
    port: 3000,
    maxRequests: null,
  };
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    if (flag === "--wasm") parsed.wasm = value;
    else if (flag === "--db") parsed.db = value;
    else if (flag === "--host") parsed.host = value;
    else if (flag === "--port") parsed.port = parseInteger(value, flag, 0, 65_535);
    else if (flag === "--max-requests") parsed.maxRequests = parseInteger(value, flag, 1, 1_000_000);
    else throw new Error(`unknown option ${flag}`);
  }
  if (parsed.wasm === null) {
    throw new Error("usage: node runtime/http-sqlite-host.mjs --wasm module.wasm [--db file] [--port number]");
  }
  return parsed;
}

function parseInteger(value, flag, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}
