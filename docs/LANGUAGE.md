# AIR 0.1 language sketch

## Design constraints

AIR 0.1 favours regularity over convenience.
The syntax is intentionally explicit, unambiguous, easy to generate, and easy to reject.
The text form is not intended to compete with human-oriented application languages.

Every accepted program has:

- One explicit AIR version.
- One stable program name.
- One flat capability block.
- One `main` function with an explicit result type.
- One effect block on the function.
- A sequence of typed statements ending in exactly one return.

## Grammar

The implemented subset is described by this EBNF:

```ebnf
program          = "air", version, ";",
                   "program", identifier, ";",
                   capability-block,
                   main-function ;

capability-block = "requires", "{", { capability }, "}" ;

capability       = "capability", capability-id,
                   "digest", string,
                   "signed-by", string, ";" ;

main-function    = "fn", "main", "(", ")", "->", "i32",
                   effect-block,
                   "{", { statement }, "}" ;

effect-block     = "effects", "{", { capability-id, ";" }, "}" ;

statement        = "print", string, ";"
                 | "return", i32, ";" ;
```

Identifiers and capability IDs are non-whitespace atoms that do not contain structural punctuation.
Strings support `\n`, `\r`, `\t`, `\"`, and `\\` escapes.
Comments begin with `#` and continue to the end of the line.

## Static semantics

`print` has the effect `wasi:stdout@1`.
The effect must appear in `main`'s effect block.
The same capability must appear in the program's `requires` block with the compiler-trusted digest and issuer.

`main` returns `i32` and must end with exactly one return statement.
The result is exported as `air_main`.
The generated WASI `_start` function invokes it and discards its result in AIR 0.1.

The compiler rejects declarations it cannot verify.
It does not warn and continue, download a similarly named component, select a newer version, or infer ambient authority.

## Lowering

An AIR 0.1 module lowers to one core WebAssembly module.
The module exports linear memory, `air_main`, and `_start`.
For standard output it imports only:

```text
wasi_snapshot_preview1.fd_write
```

String data is encoded as UTF-8 in linear memory.
Each `print` statement becomes a call to `fd_write` with file descriptor 1.

## Planned core model

The next language slice should add the following concepts without weakening the current capability rules:

```text
type UserId = u64;

record User {
  id: UserId;
  email: string;
}

fn create_user(email: string) -> result<User, CreateUserError>
effects {
  db:users.write@1;
}
requires {
  valid_email(email);
}
ensures {
  result.ok -> result.value.email == email;
}
```

Planned value semantics include integers with explicit widths, booleans, UTF-8 strings, byte sequences, lists, records, tagged variants, options, and results.
There will be no null value, implicit numeric conversion, undefined behaviour, or ambient exception mechanism.

Function calls will carry an explicit effect set.
The checker will prove that a caller's effect set contains every callee effect.
Resources such as files, sockets, database sessions, and model handles will be affine values that cannot be duplicated or used after close.

## Contracts

Preconditions, postconditions, and invariants are part of the language design but not yet implemented.
Contracts will be divided into statically provable, runtime-checkable, and host-attested forms.
The compiler must say which category it used and must never silently treat an unproved contract as proved.

## Versioning

AIR versioning applies to syntax and semantics together.
Compilers reject unknown language versions.
Capability major versions are part of capability IDs and never float during resolution.
Minor compatible evolution belongs inside a signed interface contract and exact lock digest.

