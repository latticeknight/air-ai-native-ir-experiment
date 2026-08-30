# Change EV-015

## Add hidden suspension reason

When an administrator changes status to suspended, PATCH /users/{id}/status must require a non-empty reason string in addition to status. Store that reason internally. The reason must never appear in any public response. Changing status to active is not supported. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-015-hidden-suspension-reason.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
