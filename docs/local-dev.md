# Local Development Runtime

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## Start Services

Copy `.env.example` to `.env`. Set `GITEA_ADMIN_PASSWORD` to an explicit password of at least 12 characters, and set `ESL_BOOTSTRAP_ADMIN_TOKEN` to the token the first ESL Platform Administrator will use for the initial `esl login`.

`GITEA_ADMIN_USERNAME` defaults to `eslroot`; Gitea 1.22 rejects the reserved username `admin` during bootstrap user creation.

If Docker build cannot reach npm registries in a proxied network, set `NPM_PROXY` in `.env` to the Docker-reachable host proxy address. For example, with a local proxy on Windows port `7897`:

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

Leave `NPM_PROXY` blank when Docker containers can access npm directly.

```powershell
npm run build
docker compose up --build
```

Gitea runs as ESL's internal Git backend. The local Docker runtime locks Gitea installation and disables public registration so normal setup and user onboarding happen through ESL instead of the Gitea UI.

The user-facing ESL Server is `http://localhost:3000`. API routes are served
under `/api`, and Git HTTP traffic is routed under `/git`.

`gitea-bootstrap` creates or reuses the configured Gitea administrator and writes the internal Gitea administrator token to `GITEA_ADMIN_TOKEN_FILE` in the shared bootstrap secret volume. Docker local runtime does not require opening the Gitea UI or manually creating `GITEA_ADMIN_TOKEN`.

`GITEA_ADMIN_PASSWORD` is a first-run input only. Changing it in `.env` after bootstrap does not rotate the Gitea administrator password; use `esl admin gitea password` for explicit rotation.

The API validates the internal token and ensures `GITEA_REPO_OWNER` before it starts listening.

## Admin Commands

After logging in with the bootstrap token, the platform administrator can manage the first user onboarding loop through ESL:

```powershell
npm exec -- esl login --server http://localhost:3000 --username eslroot --token-file .\bootstrap-token.txt
npm exec -- esl admin bootstrap status
npm exec -- esl admin user create alice
npm exec -- esl admin user token alice
npm exec -- esl admin user disable alice
npm exec -- esl admin gitea password --password-file .\new-password.txt
```

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
npm exec -- esl login --server http://localhost:3000 --username <user> --token-file .\user-token.txt
npm exec -- esl search my-skill --server http://localhost:3000
npm exec -- esl info @myorg/my-skill --server http://localhost:3000
```

`publish` and `install` are not part of the Phase 3 smoke path.

To expose Gitea directly for backend diagnostics or recovery, run Docker with
the debug override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build
```

That maps Gitea to `http://localhost:3001`; normal ESL workflows should keep
using `http://localhost:3000`.
