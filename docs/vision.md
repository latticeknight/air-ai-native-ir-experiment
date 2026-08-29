# AIR vision

AIR is an experiment, not a conclusion.
Its hypothesis is that a machine-oriented, capability-safe representation may let language models generate portable software more reliably and with less runtime and dependency complexity than conventional source languages.

The important comparison is AIR against independently generated Rust targeting Wasm and WASI.
TypeScript on Node.js is a secondary baseline.
AIR should continue only if controlled benchmarks show a clear, material advantage.

The project must not claim success from architectural elegance, a successful demonstration, or security properties that Rust/Wasm can reproduce equally well.
A failed hypothesis is a useful result.

The first milestone is intentionally limited to one `POST /users` application.
Language features are added only when that application or a later frozen benchmark requires them.

Stop or substantially redirect the project if AIR becomes Rust with different syntax, needs a conventional package ecosystem for basic work, is harder for models to generate or repair, cannot remain portable, or shows no material measured advantage after the benchmark suite.

