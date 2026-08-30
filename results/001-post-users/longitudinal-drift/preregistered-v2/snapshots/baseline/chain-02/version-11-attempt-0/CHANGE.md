# Change EV-011

## Add soft deletion

Add administrator-only DELETE /users/{id}. Deletion must mark the user deleted without removing any existing email-audit history. Non-administrators must be rejected. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-011-soft-delete-preserves-audit.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
