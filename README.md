# AIR

AIR is an experiment in AI-native program representation.
Its first question is deliberately narrow: can a language model generate useful, inspectable programs without first emitting a conventional source language?

This repository contains a working zero-dependency compiler prototype.
It parses AIR text, checks types and capabilities, emits a WebAssembly binary directly, and can hand that binary to Wasmtime through the AIR CLI.

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
                Wasmtime + WASI
```

AIR is not intended to replace WebAssembly, WASI, LLVM, or native instruction sets.
It is an executable specification layer above them, designed around explicit effects, deterministic structure, machine-checkable contracts, and capabilities that can be granted or withheld by the host.

## Try it

The compiler requires a current stable Rust toolchain.
Running the generated module through the AIR CLI also requires `wasmtime` on `PATH`.

```sh
cargo test
cargo run -- check examples/hello.air
cargo run -- compile examples/hello.air -o target/hello.wasm
cargo run -- run examples/hello.air
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

The MVP ships one compiler-trusted capability descriptor for standard output.
It is pinned by identifier, version, digest, and issuer.
Third-party capabilities are rejected until cryptographic signature verification and revocation are implemented.
This is a deliberate fail-closed boundary, not an implied trust mechanism.

Longer term, a component may contain code and pure data dependencies, but its entire externally visible capability requirement must be flattened into the application manifest.
Resolution produces a content-addressed lock, not an unconstrained tree of install-time scripts and transitive authority.

## Repository map

```text
air/
|-- capabilities/        Canonical trusted capability descriptors
|-- docs/
|   |-- ARCHITECTURE.md  Compiler, runtime, trust, and component design
|   |-- LANGUAGE.md      AIR 0.1 syntax and static semantics
|   `-- MVP.md           Scope, success criteria, and roadmap
|-- examples/            Valid and intentionally rejected AIR programs
|-- src/
|   |-- ast.rs           Minimal typed syntax tree
|   |-- parser.rs        Hand-written lexer and parser
|   |-- checker.rs       Type, effect, digest, and issuer checks
|   |-- wasm.rs          Direct WebAssembly binary emitter
|   |-- lib.rs           Compiler API
|   `-- main.rs          `air check`, `compile`, and `run`
`-- tests/               Runtime smoke test with no package dependencies
```

## Design documents

- [Architecture](docs/ARCHITECTURE.md)
- [Language sketch](docs/LANGUAGE.md)
- [MVP scope](docs/MVP.md)

## Status

This is a research seed, not a production language or security boundary.
The prototype proves the pipeline and the shape of capability enforcement.
It does not yet implement general functions, user-defined types, cryptographic signature verification, the WebAssembly Component Model, or WASI 0.2 and later interfaces.
