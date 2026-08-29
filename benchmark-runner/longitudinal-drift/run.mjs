#!/usr/bin/env node
import {
  configuration,
  createManifest,
  executeSchedule,
  initializeChains,
} from "./lib.mjs";

const config = configuration(process.argv.slice(2));
const manifest = createManifest(config);

await initializeChains(config, manifest);
await executeSchedule(config, manifest, (event) => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
});
