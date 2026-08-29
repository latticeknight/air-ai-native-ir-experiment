# AIR research archive

AIR tested whether a machine-oriented representation could improve AI-generated software.
The standalone implementation-language hypothesis did not outperform Rust/Wasm on generation reliability, repairability, or runtime safety.
The follow-up specification-layer hypothesis detected more mutations than the existing Benchmark 001 tests, but ordinary integration tests and Cargo policy reproduced the complete detection result with less custom tooling.

The current decision is to stop AIR-specific language and verification development.
This repository retains both prototypes, raw evidence, and falsification reports so the negative results remain reproducible.

```text
Natural-language intent
        |
        v
AIR contract experiment
        |
        +--> generated runtime policy
        +--> derived checks
        |
        v
generated Rust --> Wasm/WASI --> constrained Wasmtime host
```

The final specification-layer result is [NOT PROMISING](reports/001-air-specification-verification.md).
The useful engineering pattern is a narrow Wasmtime capability boundary combined with standard schemas, dependency policy, and focused integration tests.

## Reproduce the specification experiment

```sh
node benchmark-runner/verification-experiment/run.mjs
node benchmark-runner/verification-experiment/report.mjs
```

## Historical executable prototype

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

## Historical capability and package hypothesis

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
|-- verification/        Frozen contract validator and derived-check prototype
`-- tests/               Compiler, adversarial, Wasm, and HTTP/SQLite tests
```

## Design documents

- [Architecture](docs/ARCHITECTURE.md)
- [Language sketch](docs/LANGUAGE.md)
- [MVP scope](docs/MVP.md)
- [Project vision and kill criteria](docs/vision.md)
- [Capability model](docs/capability-model.md)
- [Specification-layer scope](docs/SPECIFICATION_LAYER.md)
- [Specification-layer experiment](reports/001-air-specification-verification.md)
- [Benchmark methodology](docs/benchmark-methodology.md)

## Status

This is a completed research archive, not a production language or security boundary.
The executable prototype and specification-layer prototype are frozen.
Benchmark 001 now compares the frozen AIR slice with an independent zero-dependency Rust/Wasm candidate under one shared Wasmtime and SQLite host.
The [controlled 20-pair AI-generation experiment](reports/001-ai-generation-b001-gpt-5-6-luna-medium-r20-v2.md) found identical 85 percent first-pass correctness and 100 percent eventual correctness for AIR and Rust/Wasm.
It found no material AIR reliability, repairability, generation-efficiency, or effective-safety advantage.
AIR produced materially smaller source representations and Wasm artifacts, but that alone does not justify the additional language and compiler layer.
The subsequent specification-layer experiment compiled 14 faulty Rust/Wasm candidates.
The existing baseline caught 8, AIR-derived verification caught 14, and a small ordinary-tooling augmentation also caught 14.
The final conclusion is **NOT PROMISING**, with a recommendation to **STOP** AIR-specific development.
