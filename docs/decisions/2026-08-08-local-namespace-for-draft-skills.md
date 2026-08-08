# ADR: Use `@local` for Local and Draft Skills

- Status: Accepted
- Date: 2026-08-08

## Context

ESL skill names use the stable package-style format:

```text
@namespace/skill-name
```

The namespace is part of the skill's stable identity. After a skill is
published, the namespace should not change because it is used in dependency
declarations, local install paths, lockfiles, adapter output paths, and platform
repository paths.

Local development has a different problem: a user may create and test a skill
before logging in or before deciding its final publishing namespace.

## Decision

Local-only skills use the `@local` namespace whenever they are not yet assigned
a stable publishing namespace.

Example:

```text
@local/code-review
```

`@local` means the skill is local, unpublished, and has not been assigned a
stable publishing namespace.

## Publishing Rule

`@local/*` skills must not be published as shared server skills.

Before publishing, the user must choose a stable namespace and rename the skill,
for example:

```text
@local/code-review
-> @cnfox/code-review
```

or:

```text
@local/code-review
-> @platform/code-review
```

The CLI may later provide an assisted rename or publish prompt, but it must not
automatically infer the target namespace from the current login without user
confirmation.

## Rationale

`@local` keeps unauthenticated local workflows simple while preserving the
stable identity model for published skills.

It also avoids treating a temporary local name as a person, team, or ownership
claim. Ownership and maintenance are separate metadata fields such as
`createdBy`, `owner`, and `maintainers`.

## Consequences

Positive:

- Users can create and test skills without logging in.
- Local test skills have a consistent namespace.
- Published skills still require an intentional stable identity.

Trade-offs:

- Publishing a local skill requires an explicit rename step.
- Existing `@local/*` dependencies are only meaningful inside the local project
  unless later migrated.
- The CLI should block or warn on `esl publish` for `@local/*`.

## Naming Rules

- Use `@local/*` only for local, unpublished, or draft skills.
- Do not use `@local/*` for shared server skills.
- Do not interpret `local` as a user, team, or organization.
- Published namespaces are stable identity namespaces, not current ownership.
