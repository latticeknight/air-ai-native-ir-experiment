# Change EV-013

## Add user status

Add a public user status field whose allowed values are active and suspended. New users default to active. Add administrator-only PATCH /users/{id}/status accepting exactly a status field. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-013-user-status.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
