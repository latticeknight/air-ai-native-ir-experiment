# Change EV-002

## Bound Unicode name length

Change user-name validation so a name must contain between 1 and 100 Unicode scalar values, inclusive. Count Unicode characters rather than UTF-8 bytes. Preserve every other current behavior and restriction.

This is the only new change for this version.
Future changes are intentionally unavailable.
