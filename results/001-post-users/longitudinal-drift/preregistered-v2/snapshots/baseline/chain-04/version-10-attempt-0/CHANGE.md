# Change EV-010

## Revoke email editing

Remove administrator email editing. Email is now immutable for every actor. The obsolete email-update behavior and the now-unused email-update and audit-write capabilities must disappear completely. The administrator role remains available for later administrator-only operations. Preserve every other current behavior and restriction.

Requirement IDs activated by this change: LD-010-email-immutable-all, LD-010-email-capabilities-revoked.
Requirement IDs retired by this change: LD-006-ordinary-email-immutable, LD-007-admin-email-update, LD-008-email-change-audit.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
