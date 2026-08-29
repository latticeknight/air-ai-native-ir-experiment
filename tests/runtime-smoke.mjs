import assert from "node:assert/strict";
import fs from "node:fs";

const wasmPath = process.argv[2];
if (!wasmPath) {
  throw new Error("usage: node tests/runtime-smoke.mjs <module.wasm>");
}

let instance;
const writes = [];
const imports = {
  wasi_snapshot_preview1: {
    fd_write(fd, iovs, iovsLength, writtenPointer) {
      assert.equal(fd, 1, "AIR should write only to standard output");
      const memory = new DataView(instance.exports.memory.buffer);
      let written = 0;
      for (let index = 0; index < iovsLength; index += 1) {
        const pointer = memory.getUint32(iovs + index * 8, true);
        const length = memory.getUint32(iovs + index * 8 + 4, true);
        writes.push(new Uint8Array(instance.exports.memory.buffer, pointer, length).slice());
        written += length;
      }
      memory.setUint32(writtenPointer, written, true);
      return 0;
    },
  },
};

const result = await WebAssembly.instantiate(fs.readFileSync(wasmPath), imports);
instance = result.instance;
instance.exports._start();

const output = Buffer.concat(writes.map((write) => Buffer.from(write))).toString("utf8");
assert.equal(output, "Hello from AIR.\n");
assert.equal(instance.exports.air_main(), 0);
console.log("runtime smoke test passed");

