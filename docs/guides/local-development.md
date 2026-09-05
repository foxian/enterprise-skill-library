# Local Development Runtime

This is the authoritative guide for starting ESL locally. For Docker Desktop,
registry, proxy, or recovery issues, see
[Docker troubleshooting](docker-troubleshooting.md).

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## Start Services

Copy `.env.example` to `.env`. Set `GITEA_ADMIN_PASSWORD` to an explicit password of at least 12 characters — it is the initial password of the ESL Administrator Account, which signs in through the Admin Console (`http://localhost:3000/admin`), not the CLI.

`GITEA_ADMIN_USERNAME` defaults to `eslroot`; Gitea 1.22 rejects the reserved username `admin` during bootstrap user creation.

If Docker build cannot reach npm registries in a proxied network, set `NPM_PROXY` in `.env` to the Docker-reachable host proxy address. For example, with a local proxy on Windows port `7897`:

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

Leave `NPM_PROXY` blank when Docker containers can access npm directly.

For Docker-specific network diagnosis and image-pull recovery, see
[Docker troubleshooting](docker-troubleshooting.md).

```powershell
npm run build
docker compose up --build
```

Gitea runs as ESL's internal Git backend. The local Docker runtime locks Gitea installation and disables public registration so normal setup and user onboarding happen through ESL instead of the Gitea UI.

The user-facing ESL Server is `http://localhost:3000`. API routes are served
under `/api`, Git HTTP traffic is routed under `/git`, and the Web admin
console (built from `packages/web`) is served under `/admin` — open
`http://localhost:3000/admin` in a browser after `npm run build`, which also
produces the web static bundle mounted into the nginx container.

## Redeploy the Web Console

The frontend is not baked into any image: `packages/web/dist` is bind-mounted
into the nginx container. Rebuild and redeploy it with:

```powershell
npm run deploy:web
```

This runs `vite build` (which updates files inside `dist` in place —
`emptyOutDir: false` keeps the directory inode stable so the container's mount
never goes stale) and recreates the `server` container. Only the recreated
container re-reads `docker-compose.yml`, so use `docker compose up -d server`,
never `docker compose restart`, after changing compose config or mounts. The
same caveat applies to single-file mounts such as `docker/nginx.conf`.

Because `dist` is no longer emptied on build, hashed assets from previous
builds accumulate; delete unused `dist/assets/*` files occasionally.

API server code is baked into the `api` image. Changes under
`packages/server` require `docker compose build api && docker compose up -d api`.
The Dockerfile copies workspace manifests before the dependency-install layer,
so code-only changes reuse the cached `npm install` layer.

`gitea-bootstrap` creates or reuses the configured Gitea administrator and writes the internal Gitea administrator token to `GITEA_ADMIN_TOKEN_FILE` in the shared bootstrap secret volume. Docker local runtime does not require opening the Gitea UI or manually creating `GITEA_ADMIN_TOKEN`.

`GITEA_ADMIN_PASSWORD` is a first-run input only. Changing it in `.env` after bootstrap does not rotate the ESL Administrator Account password; sign in to the Admin Console as the configured administrator account and change it under 平台设置 (Admin Console → Platform Settings).

The API validates the internal token before it starts listening. Skill source
repositories live under tenant organizations mapped from Gitea organizations
(see `docs/adr/0016`); the server no longer asserts a fixed platform
organization at startup.

## Reload Code Changes

After editing source, make the running stack pick up the new code with one
command:

```powershell
npm run reload:dev
```

This rebuilds all workspace packages (`npm run build`), rebuilds the `api`
image, and recreates the `api` and `server` containers. The web bundle is a
bind mount, so a browser refresh is all that is needed for frontend changes;
the `server` recreate re-reads mounted configs such as `docker/nginx.conf`.
Use `npm run reset:dev` instead when you want a clean environment (see
[Reset the Environment](#reset-the-environment)).

### Which layer needs what

| You changed | Required commands |
|---|---|
| `packages/server` | `docker compose build api && docker compose up -d api` (code is baked into the `api` image) |
| `packages/web` | `npm run build --workspace @esl/web`, then refresh the browser (`dist` is a bind mount) |
| `packages/core` | rebuild it first (`npm run build --workspace @esl/core`), then follow the server / web row above |
| `packages/cli` | `npm run build --workspace @esl/cli` (local `esl` symlinks to this repo) |
| `docker/nginx.conf` / `docker-compose.yml` / mounts | `docker compose up -d server` (recreate re-reads the config) |

`npm run reload:dev` covers every row above at once, so it is the everyday
command.

### Why not `docker compose up --build`?

`up --build` only rebuilds Docker images — it does **not** run the host
`npm run build`, so frontend changes are never picked up (nginx keeps serving
the stale `dist`). Use it for first-time bring-up or after changing compose
config; use `reload:dev` for everyday code changes.

## Login

The CLI is for organization members only: `esl login` requires `--org <orgname>`
(or prompts for it) and sends the organization and username separately; the
server assembles and validates the `<orgname>_<username>` account. Set the
server once with `npm exec -- esl config set-server http://localhost:3000` (or
the `ESL_SERVER` environment variable), then:

```powershell
npm exec -- esl login --org acme --username alice
```

The platform administrator does not log into the CLI. Open the Admin Console at
`http://localhost:3000/admin` and sign in with `GITEA_ADMIN_USERNAME` (default
`eslroot`) and the administrator password. Check the current CLI login with
`npm exec -- esl whoami` (shows organization and role).

Organization and member management moved to the Admin Console; the CLI keeps
only developer-facing commands. A Skill User can change their own password with
`esl account change-password`.

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

The seed inserts a sample skill (`@myorg/my-skill` v0.1.0) and is idempotent.
For development, the API can seed automatically on startup: set `ESL_AUTO_SEED=true`
in `.env` (default `false`, so production starts with a clean database), then
`docker compose up -d api` for the new value to reach the container.

## Reset the Environment

After development or E2E runs, stale data accumulates in the persistent volumes
(SQLite DB, Gitea repositories/orgs, bootstrap secrets). Reset the stack to a
clean, ready-to-develop state with:

```powershell
npm run reset:dev
```

This stops the Docker stack, deletes `data/api`, `data/gitea` and `data/secrets`
(after an interactive confirmation, skippable with `--yes`), recreates them via
the first-run initialisation path (startup schema creation + `gitea-bootstrap`),
waits for the API to become healthy, and re-seeds the sample skill by default.
Pass `--no-seed` to skip the re-seed. The script refuses to delete a data
directory that does not look like ESL data, and it never runs automatically —
reset is destructive by design. See `docs/adr/0018` for why reset works this way.

Reset invalidates any previous `esl login` state under `~/.skill-library/`; log
in again afterwards. Only the three data-volume subdirectories are removed:
`.env`, the web bundle, and the source tree are left untouched.

Prerequisites before running it:

- Docker Desktop must be running.
- `GITEA_ADMIN_PASSWORD` in `.env` must be at least 12 characters — the
  `gitea-bootstrap` container validates this and exits non-zero otherwise,
  which blocks the whole bring-up. This password is used to recreate the
  `eslroot` administrator after the reset.
- Anything under `data/` that is not recreated by the stack is deleted for
  good (e.g. the E2E helper `data/esl-db-tool.cjs`, which is git-ignored).
  Back it up first if you still need it.

## CLI Smoke

```powershell
npm exec -- esl login --server http://localhost:3000 --org <orgname> --username <user>
npm exec -- esl search my-skill --server http://localhost:3000
npm exec -- esl info @myorg/my-skill --server http://localhost:3000
```

For the full publish, cross-user install, update, and source smoke path, see
[Skill Release lifecycle walkthrough](skill-release-lifecycle.md).

To expose Gitea directly for backend diagnostics or recovery, run Docker with
the debug override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build
```

That maps Gitea to `http://localhost:3001`; normal ESL workflows should keep
using `http://localhost:3000`. See
[Docker troubleshooting](docker-troubleshooting.md) for the recovery workflow.
