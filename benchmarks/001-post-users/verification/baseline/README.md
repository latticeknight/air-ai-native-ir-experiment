# Ordinary-tooling comparator

This directory represents the strongest practical non-AIR alternative for the same application.
It combines OpenAPI 3.1 and JSON Schema vocabulary for HTTP shapes, a manually maintained Wasmtime capability manifest, a Cargo dependency policy, and the existing hand-written integration and security tests.

The OpenAPI document does not express the SQLite effect, row-to-response postcondition, duplicate-email database invariant, capability allowlist, or dependency limits.
Those rules remain in separate policies and tests.

The manual runtime manifest is intentionally equivalent to the manifest generated from the AIR contract.
That equivalence tests whether AIR adds enforcement or only changes where the policy is authored.

The comparator can reproduce every mechanism used by the AIR prototype with ordinary tools.
Its main disadvantage is that the same application facts are split across more authoritative files and some behavioral facts must be repeated in tests.
