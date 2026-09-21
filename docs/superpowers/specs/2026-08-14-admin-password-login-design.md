# Admin Password Login Design

## Problem Statement

ESL CLI administrator commands (`esl admin ...`) are authorized only by a
fixed bootstrap token string (`ESL_BOOTSTRAP_ADMIN_TOKEN`, default
`bootstrap-token`). The server recognizes a platform administrator by string
comparison against that token; a token minted from the administrator's Gitea
password is rejected as a normal user token.

The CLI already supports password login — `esl login --username eslroot` prompts
for a password and exchanges it for a Gitea personal access token via Basic
Auth. What is missing is a server-side path that recognizes that token as
belonging to the platform administrator.

Two further gaps:

- Client-side credentials never expire. A CLI login stays valid indefinitely,
  with no way to require re-authentication after a period of time.
- `esl admin gitea password` hardcodes the Gitea user `admin` in
  `changeUserPassword('admin', password)` (`gitea.ts`), but the real
  administrator username is `GITEA_ADMIN_USERNAME` (default `eslroot`). The
  command is broken.

## Goals

- The administrator can log in with `esl login --username eslroot` and enter
  their Gitea password; subsequent `esl admin ...` commands succeed.
- The bootstrap token remains a backup entry point for first boot and recovery.
- CLI login expires client-side after a configurable period (default 30 days),
  after which the administrator re-authenticates with their password.
- The `esl admin gitea password` username bug is fixed.

## Design

### Server: recognize Gitea admin tokens

Add a fallback to the administrator authorization path. When the presented token
does not match the bootstrap token, the server asks Gitea whose token it is and
treats it as an administrator if it belongs to the configured Gitea
administrator.

`GiteaService` gains a method:

```ts
async validateAdminUserToken(token: string): Promise<GiteaUser | null>
```

It reuses the existing `validateToken(token)` (a `GET /api/v1/user` with the
token) and returns the user only when the username equals the service's
configured `adminUsername`. It returns `null` when the token is not valid, does
not belong to the administrator, or no `adminUsername` is configured.

The admin route's `authorize` becomes asynchronous and applies, in order:

1. `repository.getPlatformAdminForToken(token)` — the existing bootstrap token
   string match and `admin_tokens` lookup.
2. `giteaService.validateAdminUserToken(token)` — the new Gitea fallback.

`AppOptions` and `buildApp` need no new parameters: `GiteaService` already holds
`adminUsername` from `GITEA_ADMIN_USERNAME`, so the route uses `giteaService`
directly.

No CLI change is required for password login: the existing
`exchangePasswordForToken` already mints a valid Gitea token for `eslroot`.

### Fix the Gitea password-change username

`GiteaService` gains `changeAdminPassword(password)` which calls the existing
`changeUserPassword` with the configured `adminUsername` instead of the
hardcoded `'admin'`. The `POST /api/admin/gitea/password` route calls the new
method.

### Client: soft login expiry

Credentials gain a `loginAt` timestamp. `credentials.json` becomes
`{ "token": "...", "loginAt": "2026-08-14T00:00:00.000Z" }`. `executeLogin`
records the current time when it saves the token.

A new `requireFreshToken(options)` helper loads credentials, throws
`Login expired; run esl login to re-authenticate` when `loginAt` is missing or
older than the configured TTL, and otherwise returns the token.

The TTL is read from `ESL_LOGIN_TTL_HOURS` (default `720`, i.e. 30 days),
following the existing `ESL_HTTP_TIMEOUT` environment pattern.

Expiry is enforced only where a token is actually required:

- `resolveAdminAuth` (all `esl admin ...` commands);
- `install`, `publish`, `source`, and `use` (git operations).

`search` and `info` are public endpoints and remain unaffected by expiry.

Backward compatibility: existing `credentials.json` files have no `loginAt` and
are therefore treated as expired, forcing a one-time re-login. Bootstrap-token
logins also record `loginAt`, so they expire on the same schedule and are
re-established by logging in with `--token-file` again.

## Auth Flow

```text
esl login --username eslroot
  -> prompt for password
  -> Basic Auth POST /api/v1/users/eslroot/tokens
  -> save { token, loginAt }

esl admin user create alice
  -> requireFreshToken (throws if expired)
  -> Authorization: token <PAT>
  -> server authorize:
       1. bootstrap token match? no
       2. Gitea validateAdminUserToken? yes (username == eslroot)
  -> administrator action proceeds
```

## Configuration

New client-side configuration:

```dotenv
ESL_LOGIN_TTL_HOURS=720
```

Server configuration unchanged. `GITEA_ADMIN_USERNAME` (default `eslroot`) is
already loaded and is now also used for the authorization fallback and the
password-change fix.

## Error Handling

| Scenario | Behavior |
| --- | --- |
| Wrong password at login | Existing `Failed to authenticate with Gitea` |
| Expired or missing `loginAt` | `Login expired; run esl login to re-authenticate` |
| Token is not the administrator's | Existing 403 `platform administrator token required` |
| Gitea unreachable during validation | Existing fetch error surfaces as a 500 |
| `GITEA_ADMIN_USERNAME` not configured | Gitea fallback disabled; bootstrap token only |

## Testing

Server:

- `validateAdminUserToken` returns the user for the administrator's token,
  `null` for other users' tokens, and `null` when no `adminUsername` is set.
- Admin routes accept a password-minted token (mocked Gitea returning `eslroot`)
  and reject unknown tokens; bootstrap token still works.
- `changeAdminPassword` calls `changeUserPassword` with `eslroot`, not `admin`.

Client:

- `executeLogin` records `loginAt`.
- `requireFreshToken` returns the token when fresh, throws when expired, and
  throws when `loginAt` is missing.
- `ESL_LOGIN_TTL_HOURS` overrides the default.
- A representative token-consuming command (e.g. `publish`) is blocked when the
  login is expired.

## Out of Scope

- Server-side token expiry or revocation (tokens remain valid on Gitea; expiry
  is a client-side session policy).
- Multiple platform administrator accounts.
- Separate admin/user CLI profiles or account switching.
- A server-side login endpoint.
