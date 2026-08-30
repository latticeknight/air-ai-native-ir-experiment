# AIR-contract Benchmark 001 maintenance project

This project is the AIR-contract longitudinal-drift pipeline.
`air.contract.json` is the canonical machine-readable specification.
Update that contract for every requirement change, run `node tools/generate.mjs`, and then update the Rust/Wasm implementation consistently.

Do not hand-edit files under `generated/`.
Do not add executable AIR language features.
Do not grant filesystem, environment, outbound network, general database, or undeclared table access.
Do not inspect outside this project or attempt to discover the independent evaluator.
