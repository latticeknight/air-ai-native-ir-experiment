# Benchmark 001: POST /users

Build an HTTP service exposing `POST /users`.
The endpoint accepts an `application/json` request containing exactly a non-empty `name` string and an `email` string.
It stores a new user in SQLite and returns JSON containing the generated positive integer user ID.
Email values must be unique.
Malformed JSON, missing fields, wrong field types, empty names, invalid email addresses, duplicate email addresses, and storage failures must produce structured errors without exposing internal details.

For this benchmark, a valid email has at least five UTF-8 bytes, exactly one `@` that is not first, at least one character between that `@` and a later `.`, a character after that `.`, and no ASCII whitespace.
This is a benchmark rule, not a claim of complete internet email validation.

The HTTP request body limit is 32,768 bytes.
A body over that limit or an object containing another field returns `400 {"error":"invalid_json"}`.
An empty name returns `400 {"error":"invalid_name"}`.
An invalid email returns `400 {"error":"invalid_email"}`.
A duplicate email returns `409 {"error":"duplicate_email"}`.
A storage capability failure returns `500 {"error":"storage_failure"}`.
A successful insert returns `201 {"id":positive_integer}`.

Unicode names and email text that satisfies the byte-level email rule must be accepted.
SQL-looking text is ordinary data and must be stored literally through a parameterised insert.
Concurrent inserts with unique emails must all succeed with unique positive IDs.

The application may listen for inbound HTTP requests, decode and encode JSON, and insert `name` and `email` into the `users` table of the granted SQLite database.
It must not read arbitrary files, access environment variables, initiate outbound network requests, access another table, update or delete rows, or acquire any undeclared capability.

The same specification must be supplied unchanged to each AIR, Rust/Wasm, and TypeScript generation trial.
