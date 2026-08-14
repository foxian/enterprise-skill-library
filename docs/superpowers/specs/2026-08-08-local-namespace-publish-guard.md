# Local Namespace Publish Guard

## Problem Statement

Users can create and test ESL skills locally before logging in or before
choosing a stable publishing namespace. The domain model now reserves
`@local/*` for these local or draft skills.

The problem is that `@local/*` currently looks like any other valid skill
identity. If a user runs `esl publish` from a local draft skill, the CLI may
silently publish it as a shared server skill. That would turn a temporary local
namespace into a permanent published identity, polluting the shared namespace
and creating hard-to-reverse repository paths, dependencies, lockfile keys, and
adapter output paths.

## Solution

ESL should treat `@local/*` as a local-only namespace and block publishing
before any server or Git side effects happen.

When a user runs `esl publish` for a skill whose identity starts with
`@local/`, the CLI should fail with a clear message explaining that local
namespace skills must be renamed before publishing. The user should choose a
stable publishing namespace such as a personal or platform namespace, update
the skill identity, validate the package, and publish again.

This preserves the local workflow while protecting the stable identity model
for shared skills.

## User Stories

1. As a local skill author, I want to create `@local/my-skill`, so that I can
   test a skill without logging in.
2. As a local skill author, I want `@local/my-skill` to install locally, so
   that I can verify the local development workflow.
3. As a local skill author, I want `@local/my-skill` to adapt to configured AI
   tools, so that I can test runtime behavior before publishing.
4. As a local skill author, I want `esl publish` to reject `@local/my-skill`,
   so that I do not accidentally publish a draft identity.
5. As a local skill author, I want the publish error to explain the rename
   requirement, so that I know how to proceed.
6. As a local skill author, I want publish rejection to happen before API
   requests, so that no partial server metadata is created.
7. As a local skill author, I want publish rejection to happen before Git
   commands, so that no remote, push, or tag operation is attempted.
8. As a local skill author, I want to rename `@local/my-skill` to a stable
   namespace, so that the same skill can later become shared.
9. As a publisher, I want non-local skill identities to publish normally, so
   that existing publish behavior remains intact.
10. As a publisher, I want `@cnfox/my-skill` or another stable namespace to be
    accepted by publish, so that intentional shared identities continue to
    work.
11. As a platform maintainer, I want `local` to never be treated as a user,
    team, or organization, so that ownership remains separate from namespace.
12. As a platform maintainer, I want namespace rules to align with the domain
    glossary, so that documentation and CLI behavior use the same language.
13. As a platform maintainer, I want created-by metadata to remain audit-only,
    so that publishing does not confuse creator identity with namespace.
14. As a platform maintainer, I want maintainers and owner metadata to remain
    separate from namespace, so that future ownership changes do not require
    renaming skills.
15. As a platform maintainer, I want tests to verify the absence of side
    effects for `@local/*` publish attempts, so that regressions are caught.
16. As a user reading CLI help, I want the local namespace rule to be
    discoverable, so that I understand why `@local/*` cannot be published.
17. As a user reading documentation, I want examples to distinguish local draft
    identities from published identities, so that I choose names correctly.

## Implementation Decisions

- Use the domain term **namespace** for user-facing documentation and messages.
  Existing code may continue to use internal `scope` naming where it is already
  established.
- Keep the skill identity format as `@namespace/skill-name`.
- Reserve `@local/*` for local, unpublished, or draft skills that have not been
  assigned a stable publishing namespace.
- Block `esl publish` for `@local/*` after package validation has identified
  the skill identity, but before any API request or Git command is attempted.
- The publish failure should be explicit and actionable. It should say that
  `@local/*` skills must be renamed to a stable namespace before publishing.
- Do not infer the target namespace from the logged-in user automatically.
  Automatic inference would make a permanent identity decision without explicit
  user consent.
- Do not change the server API contract for this feature. The server can remain
  focused on accepting valid published identities from the CLI.
- Do not rename internal database fields or existing TypeScript identifiers as
  part of this feature. The immediate goal is user-facing behavior and publish
  safety, not a broad terminology migration.
- Update user-facing help or documentation so that `@local` is described as a
  local-only namespace.

## Testing Decisions

- Test the feature at the CLI publish behavior seam. This is the highest useful
  seam because it verifies what the user experiences and confirms no downstream
  API or Git side effects occur.
- A good test should assert observable behavior: the command rejects
  `@local/*`, emits a useful error, does not call the API, and does not execute
  Git commands.
- Existing publish command tests provide the prior art for mocking network and
  Git interactions.
- Add a positive regression test showing that a non-local namespace still follows
  the existing publish path.
- Existing local install and adapt tests already cover local skill use. They do
  not need to be duplicated unless the publish guard changes shared validation
  behavior.
- Run the full test suite and build after implementation.

## Out of Scope

- Adding an interactive rename flow to `esl publish`.
- Adding an `esl rename` command.
- Automatically converting `@local/*` to the logged-in user's namespace.
- Renaming internal `scope` implementation fields to `namespace`.
- Adding server-side namespace reservation enforcement.
- Changing repository path generation.
- Changing ownership, maintainer, or permission behavior.
- Publishing this spec to a real tracker from the current environment, because
  no Gitea tracker remote or CLI workflow is configured for this repository
  checkout.

## Further Notes

This spec follows the accepted local namespace decision and the domain glossary:
`@local` is a namespace for local or draft skills, not a user, team, organization,
owner, or creator identity.

Intended issue label: `ready-for-agent`.
