# AIR target guide

Create exactly one file: `candidate/program.air`.
Do not create any other candidate file.
The file must be AIR 0.1 source accepted by the frozen AIR compiler.

AIR source begins with a version, program name, and a flat capability block:

```ebnf
program          = "air", version, ";",
                   "program", identifier, ";",
                   capability-block,
                   user-service ;
capability-block = "requires", "{", { capability }, "}" ;
capability       = "capability", capability-id,
                   "digest", string,
                   "signed-by", string, ";" ;
```

The Benchmark 001 service requires exactly these capabilities:

```text
air:http/server@1
sha256:9d8f75ab79c9a2fc51c2cfa1aa42d946741b7fcac462b1767e607bf1018879b6

air:json@1
sha256:f276fd0e2abf43cd700d17ac7d5255969821283e5f2f184dd59f1d1bb6685a14

air:sqlite/users.insert@1
sha256:b5a70c72dc2df26dd59e7508fcd06e828b89dfb1f2c6b318d5eb713be826d131
```

Each capability is signed by `air:foundation`.

The service grammar is:

```ebnf
user-service  = record, record, error, handler, endpoint ;
record        = "record", identifier, "{", { identifier, type, ";" }, "}" ;
error         = "error", identifier, "{", { identifier, ";" }, "}" ;
handler       = "fn", identifier, "(", identifier, identifier, ")",
                "returns", identifier,
                "errors", identifier, ";",
                "effects", atom-block,
                "requires", atom-block,
                "ensures", atom-block,
                "{", insert, "}" ;
atom-block    = "{", { atom, ";" }, "}" ;
insert        = "insert", capability-id,
                "table", string,
                "values", "{", { identifier, atom, ";" }, "}",
                "returning", identifier, ";" ;
endpoint      = "endpoint", atom, string, "handler", identifier, ";" ;
```

The verifier requires the input record to contain `name string;` followed by `email string;`.
The output record must contain `id i64;`.
The error variants must be `invalid_json`, `invalid_name`, `invalid_email`, `duplicate_email`, and `storage_failure` in that order.
The handler input, output, and error type names must resolve to those declarations.
The handler effect must be only `air:sqlite/users.insert@1`.
For an input binding named `input`, its preconditions must be `input.name.nonempty;` followed by `input.email.valid;`.
The postcondition must be `result.id.positive;`.
The handler body must insert through `air:sqlite/users.insert@1` into table `users`.
The insertion values must map `name` to `input.name` and `email` to `input.email` in that order, then return `id`.
The endpoint must bind `POST` and `/users` to the handler.

AIR strings use double quotes.
Comments begin with `#` and continue to the end of the line.
No other AIR forms or capabilities are available in this trial.
