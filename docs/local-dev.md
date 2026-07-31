# Local Development Runtime

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## Start Services

Copy `.env.example` to `.env` and set `GITEA_ADMIN_TOKEN` after creating a local Gitea admin token.

```powershell
npm run build
docker compose up --build
```

Open Gitea at `http://localhost:3001`, complete first-run setup, create a user, and create a personal access token.

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
