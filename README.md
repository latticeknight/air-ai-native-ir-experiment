# AIR

AIR is an experiment in AI-native program representation.
Its first question is deliberately narrow: can a language model generate useful, inspectable programs without first emitting a conventional source language?

This repository contains a working zero-dependency compiler prototype and the first HTTP/SQLite vertical slice.
It parses AIR text, checks types, contracts, effects, and capabilities, emits a WebAssembly binary directly, and runs that module inside a capability-matched reference host.

```text
LLM or human intent
        |
        v
     AIR text
        |
        v
 parser -> checker -> direct Wasm emitter
                         |
                         v
            WebAssembly module
                 /       \
                v         v
       Wasmtime + WASI   constrained HTTP/SQLite host
```

AIR is not intended to replace WebAssembly, WASI, LLVM, or native instruction sets.
It is an executable specification layer above them, designed around explicit effects, deterministic structure, machine-checkable contracts, and capabilities that can be granted or withheld by the host.

## Try it

The compiler requires a current stable Rust toolchain.
The `POST /users` reference host requires Node.js 24 because it uses the built-in SQLite module.
Running command-style modules through the AIR CLI also requires `wasmtime` on `PATH`.

```sh
cargo test
cargo run -- check examples/hello.air
cargo run -- build examples/hello.air -o target/hello.wasm
cargo run -- run examples/hello.air

cargo run -- check benchmarks/001-post-users/air/program.air
cargo run -- build benchmarks/001-post-users/air/program.air -o target/post-users.wasm
cargo run -- test benchmarks/001-post-users/air/program.air
cargo run -- serve benchmarks/001-post-users/air/program.air --db target/users.sqlite --port 3000
```

The example is intentionally explicit:

```air
air 0.1;
program hello;

requires {
  capability wasi:stdout@1
    digest "sha256:d09b856e2e70a9ad921ee7af4f22a274c3f2727c0f94193263eea4e3c3229782"
    signed-by "air:foundation";
}

fn main() -> i32
effects {
  wasi:stdout@1;
}
{
  print "Hello from AIR.\n";
  return 0;
}
```

Removing `wasi:stdout@1` from either block makes the program fail closed.
Changing the pinned digest or signer also makes it fail closed.

## Why capabilities instead of packages

AIR does not allow a package to silently acquire ambient filesystem, network, clock, process, or database access.
The root program declares one flat set of capabilities, and each function declares the subset it uses.
Components receive capabilities from their caller and cannot mint new ones.

The current compiler ships four trusted capability descriptors for standard output, inbound HTTP, JSON encoding and decoding, and insertion into the `users` SQLite table.
Each descriptor is pinned by identifier, version, digest, and issuer.
Third-party capabilities are rejected until cryptographic signature verification and revocation are implemented.
This is a deliberate fail-closed boundary, not an implied trust mechanism.

Longer term, a component may contain code and pure data dependencies, but its entire externally visible capability requirement must be flattened into the application manifest.
Resolution produces a content-addressed lock, not an unconstrained tree of install-time scripts and transitive authority.

## Repository map

```text
air/
|-- capabilities/        Canonical trusted capability descriptors
|-- benchmark-runner/    Shared Wasmtime host and independent black-box suites
|-- benchmarks/          Frozen specifications, candidates, attacks, and schemas
|-- docs/
|   |-- ARCHITECTURE.md  Compiler, runtime, trust, and component design
|   |-- LANGUAGE.md      AIR 0.1 syntax and static semantics
|   `-- MVP.md           Scope, success criteria, and roadmap
|-- examples/            Valid and intentionally rejected AIR programs
|-- runtime/             Capability-matched HTTP, JSON, and SQLite host
|-- src/
|   |-- ast.rs           Minimal typed syntax tree
|   |-- parser.rs        Hand-written lexer and parser
|   |-- checker.rs       Type, effect, digest, and issuer checks
|   |-- wasm.rs          Direct WebAssembly binary emitter
|   |-- lib.rs           Compiler API
|   `-- main.rs          `air check`, `build`, `run`, and `serve`
|-- reports/             Generated comparative conclusions and confound analysis
|-- results/             Machine-readable aggregates and complete raw samples
`-- tests/               Compiler, adversarial, Wasm, and HTTP/SQLite tests
```

## Design documents

- [Architecture](docs/ARCHITECTURE.md)
- [Language sketch](docs/LANGUAGE.md)
- [MVP scope](docs/MVP.md)
- [Project vision and kill criteria](docs/vision.md)
- [Capability model](docs/capability-model.md)
- [Benchmark methodology](docs/benchmark-methodology.md)

## Status

This is a research seed, not a production language or security boundary.
The prototype proves one deliberately specialised `POST /users` pipeline and the shape of capability enforcement.
It now has structural records, a result/error contract, runtime-checked preconditions, a checked postcondition boundary, a table-scoped insert effect, HTTP/JSON adapters, and real SQLite persistence.
It does not yet implement general-purpose functions, lists, cryptographic signature verification, a hardened host process, or the WebAssembly Component Model.
Benchmark 001 now compares the frozen AIR slice with an independent zero-dependency Rust/Wasm candidate under one shared Wasmtime and SQLite host.
The [controlled 20-pair AI-generation experiment](reports/001-ai-generation-b001-gpt-5-6-luna-medium-r20-v2.md) found identical 85 percent first-pass correctness and 100 percent eventual correctness for AIR and Rust/Wasm.
It found no material AIR reliability, repairability, generation-efficiency, or effective-safety advantage.
AIR produced materially smaller source representations and Wasm artifacts, but that alone does not justify the additional language and compiler layer.
The overall conclusion is **INCONCLUSIVE**, with a recommendation to **CHANGE DIRECTION** rather than expand AIR.
