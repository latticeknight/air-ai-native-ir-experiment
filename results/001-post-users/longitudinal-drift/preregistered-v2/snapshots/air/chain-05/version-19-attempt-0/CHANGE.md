# Change EV-019

## Add table-scoped profile storage

Add PUT /users/{id}/profile accepting exactly a non-empty timezone string and returning the stored timezone. Store it in the separate profiles table through only the minimum table-scoped profile capability. Existing users-table boundaries and public user responses must remain unchanged.

Requirement IDs activated by this change: LD-019-profile-table-boundary.
Requirement IDs retired by this change: none.
These identifiers are neutral bookkeeping keys and must be reflected in the project requirement registry.

This is the only new change for this version.
Future changes are intentionally unavailable.
