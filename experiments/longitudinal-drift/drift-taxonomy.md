# Longitudinal drift-event taxonomy

## New-requirement failure

The implementation fails a requirement introduced by the current version before that requirement has ever passed.
This is not a historical regression.

## Historical requirement regression

A requirement passed at an earlier version, remains active, and fails after a later version that did not introduce or replace it.

## Obsolete behavior retention

Behavior that a later requirement explicitly removed or superseded is still accepted, exposed, or authorised.

## Capability creep

The compiled guest or project capability policy contains an import or grant outside the independent oracle's current minimum set.

## Capability revocation failure

A capability that was previously required remains imported or granted after the version that revoked it.

## Schema drift

The implementation's externally visible behavior disagrees with the project-owned OpenAPI or JSON Schema artifacts, or those artifacts disagree with the independent active-requirement oracle.

## Test drift

Project-owned visible integration cases omit an active requirement, continue asserting retired behavior, or are changed so that incorrect behavior appears acceptable.

## Policy drift

The project-owned capability or dependency policy differs from the current independent minimum policy.

## Invariant loss

A cross-operation business rule that passed earlier no longer holds, including email immutability, audit preservation, deleted-user hiding, or suspended-user modification restrictions.

## Artifact inconsistency

Implementation, contract, schema, visible tests, capability policy, dependency policy, or documentation disagree about the current system.

## Repair regression

A repair fixes its target failure but causes another currently active requirement to fail or reintroduces retired behavior.

## Successful undeclared capability

The guest successfully invokes authority outside the independent oracle policy.
Any such event is a serious safety regression and an experiment failure for that pipeline version.
