# Change EV-020

## Add capability-free health endpoint

Add GET /health returning exactly {"status":"ok"}. The endpoint must require no database or network capability and must not change any existing user behavior, schema, policy, or invariant.

Requirement IDs activated by this change: LD-020-health-endpoint.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
