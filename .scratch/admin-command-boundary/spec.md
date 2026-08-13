## Problem Statement

ESL currently exposes Gitea as a visible setup concern, which forces users to
understand and complete backend initialization steps before they can use the
skill library. The platform needs an administrative command surface that keeps
Gitea as an internal backend, lets a platform administrator manage the runtime,
and keeps the normal user workflow centered on ESL.

## Solution

ESL will bootstrap Gitea as part of the Docker runtime and treat it as an
internal backend. The normal management path will be `esl admin`, not Gitea's
UI.

The first version of the administrative surface will stay intentionally small:

- check runtime readiness
- create a platform user
- issue a one-time token for that user
- disable a user
- let the current administrator change their own password

The CLI will continue to use tokens as the default authentication mechanism.
The administrator's first login will use the bootstrap token. The registry will
come from the client configuration by default, with command-line override only
when explicitly needed.

## User Stories

1. As a platform administrator, I want the Docker runtime to bootstrap Gitea
   automatically, so that I do not have to perform first-run Gitea setup by
   hand.
2. As a platform administrator, I want ESL to treat Gitea as an internal
   backend, so that the normal workflow stays focused on skills instead of
   infrastructure.
3. As a platform administrator, I want to check bootstrap readiness from ESL,
   so that I can confirm the runtime is ready before managing users.
4. As a platform administrator, I want to create a platform user from ESL, so
   that I can onboard a new skill user without entering Gitea directly.
5. As a platform administrator, I want to issue a token for a platform user,
   so that the user can log in to ESL without receiving a reusable password.
6. As a platform administrator, I want the issued token to be shown once, so
   that leaked token history does not accumulate in the CLI.
7. As a platform administrator, I want to disable a user from ESL, so that I
   can revoke access when someone leaves the platform or no longer needs it.
8. As a platform administrator, I want disabling a user to stop their ESL
   access, so that revoked users cannot keep using platform-managed access.
9. As a platform administrator, I want to change my own password from ESL, so
   that I can rotate credentials without using Gitea directly.
10. As a platform administrator, I want my first login to use the bootstrap
    token, so that I can enter the system before any ordinary tokens exist.
11. As a skill user, I want to log in with a token, so that I do not have to
    manage a long-lived password in the CLI.
12. As a skill user, I want my registry to be remembered in client
    configuration, so that I do not have to type the registry URL for every
    admin command.
13. As a skill user, I want to override the registry only when needed, so that
    I can temporarily point ESL at another runtime without changing my saved
    configuration.
14. As a maintainer, I want the first version of admin commands to stay small,
    so that the feature is testable and easy to reason about.
15. As a maintainer, I want Gitea UI to remain an internal recovery path rather
    than the normal administration path, so that the product surface stays
    focused.
16. As a platform administrator, I want user creation to avoid ordinary user
    passwords in the first version, so that the initial release does not pull
    in password-policy and reset flows.
17. As a platform administrator, I want the admin command set to be explicit
    about what is out of scope, so that future management features can be added
    deliberately.
18. As a CI operator, I want bootstrap status to be machine-checkable, so that
    I can verify the runtime in automation as well as by hand.

## Implementation Decisions

- Add a minimal `esl admin` command family rather than exposing broad Gitea
  administration directly.
- Keep the first release focused on `bootstrap status`, `user create`, `user
  token issue`, `user disable`, and `password change`.
- Read the active registry from client configuration by default and allow
  command-line override only for exceptional cases.
- Treat the administrator bootstrap token as the initial login credential for
  the CLI.
- Keep CLI authentication token-based after the first login.
- Do not require ordinary users to set up reusable passwords in the first
  version.
- Keep Gitea bootstrap inside the Docker runtime and out of the normal user
  workflow.

## Testing Decisions

- Test the command surface through external behavior at the CLI execution
  seam, not through internal helper details.
- Prefer the highest existing seam for admin commands so that tests exercise
  real user-visible output and exit behavior.
- Use command-level tests similar to the existing CLI command tests in this
  repository.
- Verify that the runtime-readiness command reports the expected state, that
  user creation and token issuance are observable from the CLI, and that user
  disabling changes the externally visible access behavior.
- Verify that the registry comes from saved configuration by default and can be
  overridden when explicitly provided.

## Out of Scope

- Full user listing and search in admin commands
- User enable / re-enable flows
- Admin password reset for other users
- Role management commands
- Organization management commands exposed as general admin commands
- Skill archival, transfer, or deletion commands
- A full Gitea administration UI replacement
- Any public self-service registration flow

## Further Notes

The first version is intentionally a narrow operational loop: bootstrap the
runtime, add users, issue tokens, disable users, and let the current
administrator rotate their own password. Everything else can be added later if
the operational need proves real.
