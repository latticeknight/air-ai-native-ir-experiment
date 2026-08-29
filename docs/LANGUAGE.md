# AIR 0.1 language sketch

## Design constraints

AIR 0.1 favours regularity over convenience.
The syntax is explicit, deterministic, easy to generate, and easy to reject.
It contains two benchmark-driven forms: a tiny command and the specialised `POST /users` service.
These forms are not yet a general-purpose language.

Every program starts with one AIR version, one stable program name, and one flat capability block.
No declaration, condition, field, effect, operation, or capability is ignored.

## Shared grammar

```ebnf
program          = "air", version, ";",
                   "program", identifier, ";",
                   capability-block,
                   ( command | user-service ) ;

capability-block = "requires", "{", { capability }, "}" ;

capability       = "capability", capability-id,
                   "digest", string,
                   "signed-by", string, ";" ;
```

Identifiers and capability IDs are non-whitespace atoms that do not contain structural punctuation.
Strings support `\n`, `\r`, `\t`, `\"`, and `\\` escapes.
Comments begin with `#` and continue to the end of the line.

## Command form

```ebnf
command       = "fn", "main", "(", ")", "->", "i32",
                effect-block,
                "{", { statement }, "}" ;

effect-block  = "effects", "{", { capability-id, ";" }, "}" ;

statement     = "print", string, ";"
              | "return", i32, ";" ;
```

`print` requires `wasi:stdout@1` in both the application capability block and `main` effect block.
The generated module exports `air_main` and WASI `_start` and imports only `wasi_snapshot_preview1.fd_write`.

## POST /users service form

The first service form is deliberately specialised to the frozen benchmark.
Its structural outline is:

```air
record CreateUserInput {
  name string;
  email string;
}

record CreateUserOutput {
  id i64;
}

error CreateUserError {
  invalid_json;
  invalid_name;
  invalid_email;
  duplicate_email;
  storage_failure;
}

fn create_user(input CreateUserInput)
returns CreateUserOutput
errors CreateUserError;
effects {
  air:sqlite/users.insert@1;
}
requires {
  input.name.nonempty;
  input.email.valid;
}
ensures {
  result.id.positive;
}
{
  insert air:sqlite/users.insert@1
    table "users"
    values {
      name input.name;
      email input.email;
    }
    returning id;
}

endpoint POST "/users" handler create_user;
```

The verifier requires exactly those input and output fields, error variants, effects, preconditions, postcondition, insert mapping, endpoint method, path, and handler binding.
This strictness is intentional.
A benchmark does not justify general records, arbitrary SQL, general HTTP routing, or a general expression language yet.

The generated module exports linear memory and `handle_create_user(name_ptr, name_len, email_ptr, email_len) -> i64`.
Positive results are generated user IDs.
Negative values are closed error codes mapped to the declared error type by the reference host.

The name non-empty and email-shape preconditions compile into Wasm control flow.
SQLite insertion occurs only through the imported `air_sqlite_v1.insert_user` function.
The host checks the complete Wasm import list before instantiation, so the module cannot request filesystem, environment, outbound network, another table, or another database operation.

HTTP request parsing and JSON conversion occur at the trusted boundary.
Malformed structures are rejected before invoking the AIR handler.
The positive-ID postcondition is represented by the result contract: positive IDs are success, and every non-positive result maps to a declared error.

## Rejection semantics

The compiler rejects unknown language versions, syntax, capabilities, digests, issuers, effects, fields, contracts, tables, operations, and endpoints.
It does not warn and continue, infer a capability, resolve a similarly named component, or select a newer version.

## Planned value model

Lists, booleans, byte sequences, general records, variants, options, results, local bindings, calls, conditionals, and bounded iteration remain planned.
Each addition must be required by a frozen benchmark or safety property.
There will be no null value, implicit numeric conversion, undefined behaviour, ambient exception mechanism, or implicit effect propagation.

Contracts will eventually be classified as statically proved, runtime checked, or host attested.
The compiler must record which category applies and must never silently treat an unproved contract as proved.

## Versioning

AIR versioning applies to syntax and semantics together.
Compilers reject unknown language versions.
Capability major versions are part of capability IDs and never float during resolution.
Compatible evolution must still resolve to an exact signed descriptor and lock digest.

