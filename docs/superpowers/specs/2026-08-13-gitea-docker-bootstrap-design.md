# Gitea Docker Bootstrap Design

## Problem Statement

The local Docker runtime still exposes Gitea first-run setup as a manual step.
An ESL administrator must open Gitea, create an administrator account, create a
Gitea administrator token, configure `.env`, restart the API, and create the
default organization before ESL can manage users and repositories. This makes
Gitea a visible setup concern even though ESL treats it as an internal backend.

## Design

The Docker runtime will bootstrap Gitea automatically through a one-shot
`gitea-bootstrap` service. The bootstrap service uses the official Gitea image,
mounts the same `gitea-data` volume as the Gitea service, and runs Gitea's
administrative CLI against that data directory.

The administrator provides the initial Gitea administrator password explicitly
in `.env`:

```dotenv
GITEA_ADMIN_USERNAME=admin
GITEA_ADMIN_PASSWORD=change-this-admin-password
GITEA_REPO_OWNER=esl-skills
ESL_BOOTSTRAP_ADMIN_TOKEN=bootstrap-token
```

`GITEA_ADMIN_PASSWORD` is an initialization input. Changing it after Gitea has
already been bootstrapped will not rotate the password. Password rotation after
first boot uses:

```powershell
npm exec -- esl admin gitea password --password <new-password>
```

The bootstrap service will:

- wait until the Gitea service is reachable;
- create the configured Gitea administrator if it does not already exist;
- generate a Gitea administrator access token if one has not already been
  generated for ESL;
- write the token to a shared `bootstrap-secrets` Docker volume;
- exit successfully when the runtime has already been initialized.

The API service will mount the same `bootstrap-secrets` volume and read the
Gitea administrator token from `GITEA_ADMIN_TOKEN_FILE`, defaulting to:

```dotenv
GITEA_ADMIN_TOKEN_FILE=/bootstrap/gitea-admin-token
```

`GITEA_ADMIN_TOKEN` remains a direct override for non-Docker or test scenarios,
but the Docker runtime should not require users to create or paste this token.

On startup, the API will validate that its Gitea administrator token works and
will ensure the default repository owner organization exists. This keeps Gitea
setup inside the runtime while preserving the existing server-side Gitea API
wrapper as the integration point for organization and repository management.

## Runtime Flow

```text
docker compose up
  -> gitea starts with install locked and public registration disabled
  -> gitea-bootstrap waits for Gitea readiness
  -> gitea-bootstrap creates the Gitea administrator from .env
  -> gitea-bootstrap creates or reuses the ESL admin token file
  -> api reads the token file
  -> api validates the token and ensures the default organization
  -> esl admin bootstrap status reports ready
```

## Bootstrap Status

`esl admin bootstrap status` should report readiness based on the real runtime
dependencies, not only the organization lookup. The response should distinguish
these states:

```json
{
  "ready": true,
  "gitea": "ready",
  "adminToken": "ready",
  "repoOwner": "ready"
}
```

If Gitea is unreachable, the token file is missing, the token is invalid, or
the repository owner cannot be created, `ready` should be `false` and the
specific field should identify the missing dependency.

## User-Facing Rules

- Users do not open the Gitea UI for normal setup.
- Users do not manually create or paste `GITEA_ADMIN_TOKEN` for Docker local
  runtime setup.
- `GITEA_ADMIN_PASSWORD` is required for first-time Docker bootstrap.
- The initial Gitea administrator password is not an ESL CLI login password.
- ESL CLI authentication remains token-based.
- Gitea UI remains a backend recovery and maintenance path.

## Idempotency

The bootstrap service must be safe to run repeatedly. A second `docker compose
up` against existing volumes should not recreate users, overwrite an existing
token file, or change the administrator password. If the administrator password
needs to change after initial bootstrap, the administrator uses `esl admin gitea
password`.

## Configuration

New Docker-facing configuration:

```dotenv
GITEA_ADMIN_USERNAME=admin
GITEA_ADMIN_PASSWORD=change-this-admin-password
GITEA_ADMIN_TOKEN_FILE=/bootstrap/gitea-admin-token
```

Existing configuration retained:

```dotenv
GITEA_REPO_OWNER=esl-skills
ESL_BOOTSTRAP_ADMIN_TOKEN=bootstrap-token
DATABASE_PATH=./data/esl.db
NPM_PROXY=
```

`GITEA_ADMIN_TOKEN` remains supported as an explicit override. If both
`GITEA_ADMIN_TOKEN` and `GITEA_ADMIN_TOKEN_FILE` are set, the direct token wins
so tests and non-Docker deployments can stay simple.

## Error Handling

- Missing `GITEA_ADMIN_PASSWORD` in Docker bootstrap fails the bootstrap
  service with a clear error.
- Missing token file at API startup fails server startup with a clear error
  unless `GITEA_ADMIN_TOKEN` is set.
- Invalid Gitea administrator token fails API startup and makes bootstrap
  status report `adminToken: "invalid"` when the server can still answer.
- Organization creation failures fail API startup because publishing and user
  onboarding depend on the default organization being ready.

## Testing

- Unit-test server config loading for `GITEA_ADMIN_TOKEN_FILE` and direct-token
  precedence.
- Unit-test the Gitea service methods needed for token validation and
  organization creation.
- Unit-test API startup ensure logic with fake Gitea service responses.
- CLI-test `bootstrap status` output for ready and not-ready responses.
- Keep Docker end-to-end bootstrap verification as a documented manual smoke
  until the repository has a stable Docker integration test harness.

## Out of Scope

- Production secret-manager integration.
- Public self-registration.
- ESL username/password login.
- Web UI setup wizard.
- Multiple Gitea administrator accounts.
- Automatic password rotation from `.env` after first boot.
