# Local Development Runtime

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## Start Services

Copy `.env.example` to `.env`. The initial `GITEA_ADMIN_TOKEN` value can stay as `replace-with-local-gitea-admin-token` for first startup; Phase 3 smoke checks do not create repositories through the API Server.

If Docker build cannot reach npm registries in a proxied network, set `NPM_PROXY` in `.env` to the Docker-reachable host proxy address. For example, with a local proxy on Windows port `7897`:

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

Leave `NPM_PROXY` blank when Docker containers can access npm directly.

```powershell
npm run build
docker compose up --build
```

Open Gitea at `http://localhost:3001`, complete first-run setup, create a user, and create a personal access token.

After Gitea is initialized, replace `GITEA_ADMIN_TOKEN` in `.env` with an admin token and restart the `api` service when you want API-backed repository creation to work:

```powershell
docker compose up -d api
```

Before publishing a skill, create the `esl-skills` organization in local Gitea. Set `GITEA_REPO_OWNER` in `.env` if you use a different organization.

## Local Skill Namespace

Use the reserved `@local` namespace for local or draft skills that are not ready
to publish:

```powershell
npm exec -- esl init @local/my-skill
npm exec -- esl validate .\my-skill
npm exec -- esl install .\my-skill
npm exec -- esl adapt
```

`@local/*` skills can be created, installed, and adapted locally, but they
cannot be published to the shared server. Before publishing, rename the skill to
a stable namespace:

```text
@local/my-skill -> @cnfox/my-skill
```

or:

```text
@local/my-skill -> @platform/my-skill
```

The namespace is part of the stable skill identity. It is not the current owner,
creator, or maintainer.

## Seed Metadata

Run the seed script against the API database path used by Docker Compose:

```powershell
docker compose exec api npm run seed --workspace @esl/server
```

## CLI Smoke

```powershell
npm exec -- esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username <user> --token <token>
npm exec -- esl search my-skill --registry http://localhost:3000/api
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

`publish` and `install` are not part of the Phase 3 smoke path.
