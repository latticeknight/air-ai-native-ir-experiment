# Change EV-014

## Prevent suspended-user modification

Suspended users may still be returned by GET /users/{id}, but PATCH /users/{id} must not modify them. Return a structured user_suspended error. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-014-suspended-user-immutable.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
