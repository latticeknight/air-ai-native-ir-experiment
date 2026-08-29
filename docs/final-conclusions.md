# Final conclusions

## Decision

**Overall: NOT PROMISING.**

**Recommendation: STOP AIR-specific development.**

AIR is technically feasible.
The evidence does not justify maintaining it as either a new implementation language or a custom specification and verification platform.

## What was learned

The first vertical slice showed that an LLM-oriented representation can compile directly to small, deterministic WebAssembly and can make authority explicit before runtime.
That was a feasibility result, not a comparative advantage.

The Rust/Wasm comparison showed that a narrow Wasmtime import boundary can reproduce AIR's effective runtime capability safety.
The controlled generation experiment showed identical 17/20 first-pass and 20/20 eventual correctness for AIR and Rust.
AIR produced smaller source and Wasm artifacts and used 12.3 percent fewer reported tokens per successful output, but the token result was below the predefined materiality threshold.

The specification-layer pivot showed that one declarative contract can generate coherent capability policy and derived checks.
It detected all 14 seeded compiling defects, compared with 8/14 for the existing baseline.
Five ordinary integration tests and one Cargo dependency policy then raised the ordinary baseline to the same 14/14 result with no AIR-specific platform.

## What AIR did better

AIR had two measured advantages that remain real:

- It generated runtime capability configuration from the same source as its verification plan.
- It reduced drift risk by centralising behavior, effects, capabilities, dependencies, and resource limits.

Those advantages were not large enough in Benchmark 001 to outweigh the cost and risk of a custom schema, parser, validator, generator, verifier, and ecosystem.

## What existing tooling reproduced

Existing mechanisms reproduced the outcomes that mattered most:

- Wasmtime import controls reproduced the effective runtime sandbox.
- Ordinary integration tests reproduced the added behavioral defect detection.
- Cargo metadata and policy reproduced the dependency constraint.
- OpenAPI 3.1 and JSON Schema 2020-12 represented request and response shapes.
- Explicit runtime manifests represented the same effective capability allowlist.

## Practical direction

The strongest remaining intuition is to improve machine-verifiable specifications around existing implementation languages.
A practical stack can combine OpenAPI, JSON Schema, capability policies, property and integration tests, dependency policy, and explicit invariants.
AI can generate conventional implementations while automated verification checks them against those independent artifacts.

This direction does not require AIR.

## Limits of the conclusion

The evidence covers one benchmark, one model configuration for the controlled generation experiment, one machine, 40 final generation runs, 14 seeded faults, and one correct mutation control.
The experiments do not prove that every future AI-native language or contract system lacks value.
They show that this AIR design did not earn its additional platform cost under its own predefined criteria.

Any future attempt should begin with a distinct hypothesis and evidence that standard tooling cannot provide the proposed advantage.
