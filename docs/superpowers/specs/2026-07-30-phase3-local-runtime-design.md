# Phase 3 Local Runtime Design

## Status

Approved for implementation planning.

## Goal

Phase 3 turns the Phase 2 server and CLI code into a locally runnable system. The goal is to prove that the API Server can run as a real HTTP process, that a local Gitea service can support authentication, and that the host CLI can call `login`, `search`, and `info` against local services.

This phase does not require real `publish` or `install` end-to-end Git HTTP workflows. Those remain a later phase.

## Scope

Included:

- Add a runnable `@esl/server` process.
- Add Docker Compose local development environment for Gitea and API Server.
- Add API Server health endpoint.
- Add environment-based server configuration.
- Add a development seed script for deterministic skill metadata.
- Document a copy-pasteable local smoke workflow.
- Verify `login`, `search`, and `info` against local services.

Excluded:

- Real `esl publish` end-to-end push workflow.
- Real `esl install` end-to-end clone workflow.
- Nginx reverse proxy.
- HTTPS.
- Production deployment automation.
- Automatic first-run Gitea account setup.

## Architecture

Docker Compose runs two services:

- `gitea`: local Gitea for user/token validation and future Git HTTP workflows.
- `api`: `@esl/server`, using SQLite for skill metadata and Gitea for token validation.

The CLI runs on the host machine via `npm exec -- esl ...`. Keeping the CLI on the host avoids container shell friction and matches how developers will usually test local command behavior.

The API Server reads configuration from environment variables:

- `PORT`: HTTP listen port. Defaults to `3000` when omitted.
- `DATABASE_PATH`: SQLite database path. Required for runtime and seed.
- `GITEA_URL`: base URL used by API Server to call Gitea REST API. Required for runtime.
- `GITEA_ADMIN_TOKEN`: admin token used by API Server for repository-management operations. Required for runtime even though Phase 3 does not exercise publish.

## API Server Runtime

`packages/server` should expose `src/server.ts` as the runtime entry. It:

- reads and validates environment configuration,
- creates `GiteaService`,
- calls `buildApp`,
- starts Fastify on the configured port,
- logs a concise startup message,
- exits with a clear error message when required configuration is missing.

`packages/server/package.json` should include a `start` script that runs the built runtime entry. A development script may be added if it follows existing repo conventions, but it is not required for this phase.

## Health Endpoint

Add `GET /health`.

The endpoint returns a small JSON response proving the HTTP process is alive, for example:

```json
{
  "ok": true,
  "service": "esl-api"
}
```

`/health` must not require Gitea to be initialized or reachable. It is a process health check, not a dependency readiness check.

## Seed Script

Add a development-only seed script for local smoke testing. The script inserts deterministic metadata into the API SQLite database, including one public sample skill:

- name: `@myorg/my-skill`
- scope: `myorg`
- skillName: `my-skill`
- description: `Sample seeded skill`
- author: `dev`
- visibility: `public`
- gitRepoPath: `myorg/my-skill`
- version: `0.1.0`

The seed script must be idempotent. Running it multiple times should leave one skill record and one version record without failing on uniqueness constraints.

The seed script reads `DATABASE_PATH` from the environment. If `DATABASE_PATH` is missing, it exits with a clear error.

## Local Development Workflow

Target workflow:

```powershell
npm run build
docker compose up --build
npm run seed --workspace @esl/server
npm exec -- esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username <user> --token <token>
npm exec -- esl search my-skill --registry http://localhost:3000/api
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

Gitea account and token creation may remain manual in this phase. The local development documentation must explain the required Gitea setup steps clearly.

If Compose maps Gitea to a different host port, the documented `--git-base` URL must match the Compose file.

## Error Handling

Server startup:

- Missing `DATABASE_PATH`, `GITEA_URL`, or `GITEA_ADMIN_TOKEN` should fail before listening.
- Error messages should name the missing variable.

Seed:

- Missing `DATABASE_PATH` should fail before attempting database access.
- Database initialization or insert failures should surface as command failures.

CLI:

- Existing CLI network error behavior may remain unchanged unless this phase exposes a blocker.
- This phase should not introduce broad CLI error-handling refactors.

## Tests

Add focused automated tests for:

- server environment parsing,
- `/health` response,
- seed script idempotency,
- any runtime wiring that can be tested without binding a real external port.

Existing verification remains required:

```powershell
npm test
npm run build
```

Manual smoke verification for this phase:

- API Server `/health` responds when Compose is running.
- Seed script inserts sample metadata.
- `esl search` returns the seeded skill.
- `esl info @myorg/my-skill` returns the seeded skill.
- `esl login` stores config when pointed at local Gitea with a valid token or supported login flow.

## Follow-Up Phase

The next phase should extend the smoke path to real `publish` and `install`:

- create or reuse a Gitea repository,
- push skill content over Git HTTP,
- resolve versions,
- clone over Git HTTP,
- define remote replacement and adaptation policy.
