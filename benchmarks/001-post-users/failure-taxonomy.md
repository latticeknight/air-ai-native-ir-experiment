# Benchmark 001 AI-generation failure taxonomy

Each unsuccessful attempt receives one primary category and may receive secondary categories.
Classification uses independent compiler, host, functional, security, and anti-gaming diagnostics.

- `syntax_parse_error`: AIR parsing or Rust syntax parsing failed.
- `type_error`: Names, types, lifetimes, traits, or function signatures failed static checking.
- `missing_capability_declaration`: Required authority was used but not declared.
- `invalid_capability_declaration`: A capability identifier, digest, signer, effect, or authority set was invalid.
- `compilation_error`: Compilation failed for a reason not covered by syntax or types.
- `linker_wasm_error`: The generated Wasm artifact or its imports or exports violated the guest ABI.
- `startup_runtime_failure`: The shared host could not start or invoke the candidate.
- `wrong_http_behaviour`: Status codes or structured response bodies differed from the specification.
- `validation_bug`: Required name, email, JSON, size, or Unicode validation was incorrect.
- `persistence_bug`: Insert, duplicate handling, literal storage, generated ID, or unavailable-database behaviour was incorrect.
- `concurrency_bug`: Concurrent external requests did not produce the required unique successful inserts.
- `security_capability_violation`: An undeclared capability was requested or an attack crossed the boundary.
- `test_specific_hardcoding`: Source or agent activity attempted to detect or special-case the benchmark harness or fixtures.
- `dependency_build_failure`: A dependency, manifest, offline build, build script, or external tool assumption failed.
- `incorrect_api_assumption`: The candidate assumed an unavailable AIR, Rust, Wasm, WASI, memory, or host API.
- `other`: A retained diagnostic does not fit another category.
