# Original hypothesis and kill criteria

## Research question

> If AI increasingly writes and maintains software, do we still need to use programming languages designed primarily for humans?

The initial AIR hypothesis was that a machine-first, portable representation could improve the safety, simplicity, reliability, and generation efficiency of AI-produced software.
The experiment used WebAssembly and WASI as the portable execution substrate instead of inventing another backend.

## Proposed system

```text
Human intent
    |
    v
AI
    |
    v
AIR
    |
    v
parser, type checker, capability verifier
    |
    v
WebAssembly / WASI
    |
    v
Wasmtime
```

AIR was designed around explicit effects, flat capabilities, contracts, deterministic compilation, and content-addressed components.
Programs were not meant to acquire ambient authority through package installation or transitive dependencies.
The root program had to declare the complete external capability surface.

## Why Rust/Wasm was the comparator

The relevant alternative was not an unconstrained JavaScript or Python process.
Rust provides memory safety and strong static checking, while WebAssembly and Wasmtime provide portable execution and an explicit import boundary.
AIR therefore had to demonstrate value beyond best-practice Rust/Wasm with the same narrow capability API.

## Predefined evidence standards

The project treated these outcomes as potentially meaningful AIR advantages:

- Materially higher first-pass AI-generation correctness.
- Materially fewer automated repair iterations.
- Structural prevention of undeclared capabilities.
- Dramatically lower dependency complexity.
- Substantially lower model-token cost.
- A materially smaller deployment or runtime surface.

AIR did not need to beat Rust on raw runtime speed.
Reasonable runtime overhead was acceptable if it bought substantial safety or reliability.

The controlled-generation experiment predefined a 15 percentage-point reliability difference as material.
A reported-token-per-success difference of at least 20 percent was material, while a difference of at most 10 percent was a tie.
All generations, repairs, and failures had to remain in the dataset.

## Kill criterion

The central falsification question was:

> Could best-practice Rust, Wasmtime, and a well-designed capability API reproduce AIR's advantages without introducing AIR?

AIR would stop if it was effectively Rust/Wasm with another syntax and compiler layer but without meaningful gains in safety, AI reliability, simplicity, or efficiency.
A negative result was defined as a successful experiment.

## Outcome

The implementation-language comparison did not show material reliability, repairability, generation-efficiency, or effective-safety advantages.
The specification-layer pivot produced a real configuration-coherence advantage, but ordinary tests, schemas, dependency policy, and the existing Wasmtime boundary reproduced its complete seeded-defect detection result.
The kill criterion was met and AIR-specific development stopped.
