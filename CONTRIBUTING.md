# Contributing

AIR is a completed research experiment.
The implementation-language and AIR-specific verification directions are frozen after the recorded falsification tests.

Contributions are welcome when they improve reproduction, correct factual or methodological errors, clarify limitations, or identify a mismatch between committed evidence and a report.

Please do not open feature requests intended to turn AIR into a production programming language.
A proposal to reopen language development would require a new research question, predefined success and kill criteria, and evidence that existing tools cannot answer the question more simply.

## Reproduction reports

When reporting a reproduction result, include:

- Operating system and architecture.
- Rust, Node.js, and Codex CLI versions where applicable.
- The exact command run.
- Whether committed outputs changed.
- Complete diagnostics without credentials, session identifiers, or private filesystem paths.

Do not commit `.env` files, credentials, authentication data, private Codex configuration, or unsanitised generation telemetry.

## Changes

Keep benchmark implementations, independent tests, and evaluators separate.
Do not change historical result files to improve AIR's apparent outcome.
If a correction changes a conclusion, preserve the earlier evidence and explain the correction explicitly.

Run the checks documented in [README.md](README.md) before submitting a change.

## License

By contributing, you agree that your contribution is licensed under the repository's MIT License.
