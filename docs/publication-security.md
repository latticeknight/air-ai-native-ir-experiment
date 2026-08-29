# Publication security and evidence integrity

## Review scope

The complete tracked repository and all reachable Git commits were reviewed before public release.
The review covered credentials, environment files, authentication material, private URLs, local filesystem paths, machine identifiers, Codex session identifiers, and temporary execution telemetry.

Gitleaks 8.30.1 scanned all seven research commits and reported zero detected secrets before and after sanitisation.
Additional repository-specific searches found no API keys, GitHub tokens, Codex credentials, passwords, private account data, or tracked environment files.

## Sanitised metadata

The controlled-generation evidence originally contained Codex thread identifiers and machine-specific macOS temporary-directory prefixes.
Those values were not needed to evaluate correctness, safety, token usage, repairability, or performance.

The public history replaces:

- UUID-form Codex thread identifiers with `<redacted-session-id>`.
- Machine-specific macOS temporary-directory prefixes with `/tmp/`.

The two commits containing that metadata were rewritten before any public remote was created.
The seven-commit sequence, commit messages, authorship, implementation changes, candidates, failures, test results, measurements, and conclusions were preserved.

## Preserved evidence

The public archive retains:

- Every final run record and repair count.
- Exact reported token totals and timing measurements.
- Generated AIR and Rust candidate snapshots for every attempt.
- Raw functional and capability-test results.
- Sanitised Codex JSONL event streams, diagnostics, and final messages.
- Engineering benchmark raw results.
- Mutation candidates, build diagnostics, detection matrix, and summaries.

The placeholder values make the archived sessions non-resumable.
That does not affect report regeneration because completed-run reports use the retained metrics rather than Codex session identity.

## Fresh generation runs

The generation runner must retain a live session identifier locally while performing automated repairs.
Fresh experiment directories can therefore contain private execution metadata.
The repository ignore rules keep new generation result directories out of Git until they have received an equivalent publication review.

Credentials must be supplied through authenticated tooling or environment variables.
They must never be written to result files, committed `.env` files, or public diagnostics.
