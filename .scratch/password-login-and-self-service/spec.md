Status: ready-for-agent

## Problem Statement

A Skill User cannot actually log in to ESL with a password. When a platform
administrator creates a user, ESL assigns a random UUID as the user's Gitea
password, so no human knows the password and the user cannot authenticate. There
is no way for a Skill User to set or change their own password, and no
administrator path to set an initial password or recover a forgotten one. This
leaves password login available only to the ESL Administrator Account and forces
all user onboarding to go through issued tokens.

## Solution

The platform administrator will set an initial password when creating a Skill
User, and the Skill User will log in with `esl login` using that username and
password. By default the administrator does not choose the password: ESL
generates a random one and shows it exactly once for the administrator to hand
to the user. The password is hosted and validated by Gitea; ESL continues to act
as a proxy and never stores passwords itself.

Skill Users can change their own password with `esl account change-password`,
which verifies the current password before applying the new one. The platform
administrator can set or reset any user's password with `esl admin user
set-password`, which also serves as the recovery path for forgotten passwords
and migrates users created with the old random-password behavior.

## User Stories

1. As a platform administrator, I want to create a Skill User with a random
   initial password shown exactly once, so that the user can log in with
   `esl login` without receiving a token and without me having to design their
    credential.
2. As a platform administrator, I want to optionally supply a custom initial
   password via a `--password-file`, so that scripted and non-interactive
   onboarding works.
3. As a platform administrator, I want the initial password to be applied to the
   user's Gitea account, so that the single password is recognized by both ESL
   login and the Git backend.
4. As a Skill User, I want to log in with my username and password through
   `esl login`, so that I authenticate with a credential I actually know.
5. As a Skill User, I want the login password to be hidden while typing, so that
   onlookers cannot read it.
6. As a Skill User, I want a successful login to return a token that ESL stores
   locally with a `loginAt` timestamp, so that subsequent commands use the same
   client-side session policy as today.
7. As a Skill User, I want an invalid password login to fail with a clear
   authentication error, so that I understand why I cannot log in.
8. As a Skill User, I want to change my own password, so that I can rotate the
   credential if I suspect it leaked.
9. As a Skill User, I want changing my password to require my current password,
   so that a stolen session token alone cannot change my credential.
10. As a Skill User, I want the new password confirmed before it is applied, so
    that typos do not lock me out.
11. As a Skill User, I want the new password to take effect in Gitea, so that I
    can continue to use the same credential for Git operations.
12. As a Skill User, I want the existing `esl admin account change-password`
    command to keep working, so that the administrator's password-change path is
    not broken by this feature.
13. As a platform administrator, I want to set or reset any user's password
    with `esl admin user set-password`, so that a forgotten password can be
    recovered without deleting the user.
14. As a platform administrator, I want `set-password` to also serve as the
    migration path for users created with the old random-password behavior, so
    that existing users can start logging in with passwords.
15. As a platform administrator, I want `set-password` to accept a random
    password by default and a `--password-file` override, so that both commands
    behave consistently and I do not have to design user passwords.
16. As a maintainer, I want the password to travel from CLI to ESL Server to
    Gitea without being persisted by ESL, so that ESL stays free of stored
    password material.
17. As a maintainer, I want the admin-only password operations to require a
    platform administrator token, so that ordinary Skill Users cannot set other
    users' passwords.
18. As a maintainer, I want the user self-service password change to require a
    valid Skill User Token, so that unauthenticated callers cannot change
    passwords.
19. As a security reviewer, I want passwords sent to ESL to be encrypted in
    transit and never logged, so that credentials are not exposed in network
    traces or logs.

## Implementation Decisions

- Gitea remains the single password authority. ESL validates passwords by
  proxying them to Gitea and never stores password hashes in its own database.
- Password login continues to go through `POST /api/auth/login`, which proxies
  the username and password to Gitea with Basic Auth and returns a Gitea token
  that ESL stores as a SHA-256 hash in `admin_tokens`.
- User creation (`POST /api/admin/users`) generates a random initial password
  by default and returns it exactly once in the response. The administrator can
  instead provide a custom initial password with `--password-file` (or an
  explicit `--password <value>` flag), in which case no generated password is
  returned.
- A new user self-service endpoint `POST /api/auth/password` changes the
  authenticated Skill User's own password. It requires the current password
  (`oldPassword`) and the new one (`newPassword`), validates the current
  password through Gitea, then applies the new password through the Gitea admin
  API.
- A new administrator endpoint `POST /api/admin/users/:username/password`
  sets or resets any user's password. It requires a platform administrator
  token and reuses the existing Gitea admin password-change call. By default it
  generates a random password and returns it exactly once; with `--password`
  or `--password-file`, the administrator supplies the new password instead.
- The existing `POST /api/admin/account/password` command and its CLI
  `esl admin account change-password` remain unchanged.
- The CLI gains `esl account change-password` (prompts for current and new
  password, calls the user self-service endpoint) and `esl admin user
  set-password <username>` (by default generates a random password and prints it
  once; with `--password-file` the administrator supplies the new password). A
  `--random` flag explicitly requests random generation; `--random` and
  `--password-file` are mutually exclusive. Both commands follow the same
  password-supply rules as user creation.
- The password prompts reuse the existing hidden-input and confirm-input helper
  patterns already used by `esl login` and `esl admin account change-password`.
- No schema change is required. Password state continues to live only inside
  Gitea.
- The client-side session policy is unchanged: credentials remain
  `{ token, loginAt }` with the existing TTL behavior.

## Testing Decisions

- Test external behavior only, never internal helpers. A good test describes
  what the user observes and the HTTP calls ESL makes, not which function is
  called.
- Test at the highest existing seams:
  - CLI command tests (`packages/cli/tests/admin.test.ts`,
    `packages/cli/tests/login.test.ts`): verify that `esl login`, user creation
    with an initial password, `esl account change-password`, and `esl admin
    user set-password` produce the expected HTTP requests and user-visible
    output and errors, using a mock `fetch`.
  - Server route tests (`packages/server/tests/app.test.ts`): verify
    `POST /api/admin/users` with an initial password, `POST /api/auth/password`,
    and `POST /api/admin/users/:username/password` external behavior (success,
    authentication failures, wrong-password handling, token requirements) using
    `app.inject` with a mocked GiteaService.
  - GiteaService unit tests (`packages/server/tests/gitea-service.test.ts`):
    verify the exact Gitea endpoints and request bodies for user creation with a
    password, password change, and password login (Basic Auth header, admin
    token header, `password` field).
- Prior art exists in the repository: the CLI admin command tests, login tests,
  Fastify app route tests with mocked GiteaService, and GiteaService fetch-mock
  tests all follow these patterns.

## Out of Scope

- Replacing Gitea as the password authority or storing password hashes in ESL.
- Password strength policy or validation rules.
- Forced password change on first login.
- Password reset via email or any other recovery channel besides the
  administrator `set-password` command.
- Token revocation or server-side session expiry (unchanged from today).
- A web-based login or password-change UI.
- Exposing the Gitea backend UI on a new port (tracked separately).

## Further Notes

This spec follows ADR 0002, ADR 0003, and ADR 0004: Gitea remains the internal
Git Backend, and ESL never owns password material. The glossary in `CONTEXT.md`
now defines Skill User Credential, Skill User Initial Password, and Skill User
Password Change. Verify changes with `npm test` and `npm run build`.
