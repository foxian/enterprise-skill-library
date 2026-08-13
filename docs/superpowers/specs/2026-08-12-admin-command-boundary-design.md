# Admin Command Boundary Design

## Problem Statement

ESL needs an administrative command surface that lets a platform administrator
bootstrap and manage the skill library without forcing users to understand
Gitea as a separate product. The first version should stay small enough to ship
without pulling in a broad user-management or policy system.

## Design

The first version of `esl admin` is a minimal operational surface:

```text
esl admin bootstrap status
esl admin user create <username>
esl admin user token issue <username>
esl admin user disable <username>
esl admin password change
```

`bootstrap status` reports whether the runtime is ready. It is for admins and
CI checks, and it reads the active registry from the client configuration unless
overridden on the command line.

`user create` creates a platform user record. The first version does not create
an everyday password for ordinary users.

`user token issue` issues a token for the target user and returns it once.

`user disable` disables the user and invalidates their ability to continue using
ESL-managed access.

`password change` lets the current administrator update their own password.

## User-Facing Rules

- CLI authentication uses tokens by default.
- The administrator's first login uses the bootstrap token.
- The registry is stored in the client configuration and does not need to be
  repeated for every admin command.
- Gitea bootstrap remains an internal runtime concern.

## Out of Scope

- `esl admin user enable`
- `esl admin user list`
- `esl admin user password reset <username>`
- `esl admin role grant`
- `esl admin org ensure`
- `esl admin config set`
- `esl admin skill delete`

## Notes

This boundary keeps the first version focused on a single operational loop:
bootstrap the runtime, create users, issue tokens, disable users, and let the
administrator rotate their own password.
