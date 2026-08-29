# AIR capability model

Capabilities are the only path from generated AIR code to external authority.
They are declared at application level, narrowed at function level, checked before compilation, encoded into Wasm provenance, and matched again by the host at instantiation.

The first HTTP service declares three flat capabilities:

- `air:http/server@1` permits the reference host to expose one inbound endpoint.
- `air:json@1` permits the reference host to decode the request and encode the response.
- `air:sqlite/users.insert@1` permits the Wasm handler to insert `name` and `email` into the `users` table.

The generated Wasm module imports only `air_sqlite_v1.insert_user`.
The host checks the complete import list and refuses a module requesting anything else.
HTTP and JSON are boundary adapters driven by the checked endpoint metadata and are not handles available to application logic.

There is no filesystem, environment, outbound HTTP, clock, random, logging, or general database import.
There is no mechanism through which an AIR component can dynamically resolve another capability.

Capability descriptors are content-digest pinned and name a trusted issuer.
The current compiler uses built-in descriptor digests as a temporary trust root.
The issuer label is not yet a cryptographic signature.
Third-party capability loading remains disabled until signature, expiry, and revocation verification exist.

The Node reference host demonstrates module isolation but is not yet a hardened process sandbox.
The AIR Wasm module cannot invoke undeclared Node APIs, but the trusted host process itself runs with the operating-system authority of its caller.
Production-grade host sandboxing remains open work and must not be claimed as complete.

