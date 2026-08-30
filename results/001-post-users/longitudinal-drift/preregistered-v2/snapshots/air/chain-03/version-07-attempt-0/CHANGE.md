# Change EV-007

## Add administrator email editing

Recognize the administrator actor role supplied by the shared host. An administrator may use PATCH /users/{id} with exactly an email field to change that user's email. Non-administrators still may not change email. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-007-administrator-role, LD-007-admin-email-update.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
