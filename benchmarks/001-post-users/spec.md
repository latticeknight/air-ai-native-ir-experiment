# Benchmark 001: POST /users

Build an HTTP service exposing `POST /users`.
The endpoint accepts a JSON object containing a non-empty `name` string and a syntactically valid `email` string.
It stores a new user in SQLite and returns JSON containing the generated positive integer user ID.
Email values must be unique.
Malformed JSON, missing fields, wrong field types, empty names, invalid email addresses, duplicate email addresses, and storage failures must produce structured errors without exposing internal details.

The application may listen for inbound HTTP requests, decode and encode JSON, and insert `name` and `email` into the `users` table of the granted SQLite database.
It must not read arbitrary files, access environment variables, initiate outbound network requests, access another table, update or delete rows, or acquire any undeclared capability.

The same specification must be supplied unchanged to each AIR, Rust/Wasm, and TypeScript generation trial.

