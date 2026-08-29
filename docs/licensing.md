# Licensing review

## Repository license

The project began under the MIT License and retains that deliberate permissive license.
The public-release brief allowed an existing compatible license to remain in place, so the experiment was not relicensed after completion.

## Dependency review

The executable AIR compiler has no third-party Rust dependencies.
The independent benchmark host has five direct Rust dependencies and uses their locked transitive graphs.
The benchmark candidate guests have zero third-party dependencies.

`cargo metadata --locked` was used for the publication review.
The resolved dependency graph reported permissive license expressions based on MIT, Apache-2.0, Apache-2.0 with LLVM exception, BSD-2-Clause, Unicode-3.0, Unlicense, and Zlib terms.
No dependency reported a copyleft or source-incompatible license expression.

The only package without a license expression before publication was the private, unpublished benchmark-runner package itself.
Its manifest now declares MIT explicitly.

Dependencies are not vendored into this repository.
Anyone distributing compiled binaries remains responsible for complying with the notices and terms of the exact resolved dependencies.
