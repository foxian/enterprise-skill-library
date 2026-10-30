# Enterprise Skill Library

[![CI](https://github.com/foxian/enterprise-skill-library/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/foxian/enterprise-skill-library/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@foxian/esl)](https://www.npmjs.com/package/@foxian/esl)
[![License: MIT](https://img.shields.io/npm/l/@foxian/esl)](LICENSE)

English | [简体中文](README.zh-CN.md)

Enterprise Skill Library (ESL) is the AI skill marketplace for your organization:
publish, discover, install, and govern AI Agent skills across teams. As simple as
npm, as reliable as Git. Works with Claude Code, Codex, Cursor, Trae, WorkBuddy,
and other AI tools.

## Official website

- **Project website** — <https://www.enterprise-skills.com>: product overview,
  feature tour, architecture notes, and documentation.
- **Public cloud instance** — <https://cloud.enterprise-skills.com/>: the server
  the CLI uses by default. Register or sign in there to browse and install
  skills published to the public registry.

When no Server URL is supplied, the CLI uses the public cloud Server
`https://cloud.enterprise-skills.com/`. For a private, self-hosted, or local
instance, override it with `--server`, the `ESL_SERVER` environment variable, or
`esl config set-server`.

## Why ESL

AI Agent skills are becoming company assets, but they usually live scattered in
individual repositories and chat threads. ESL gives them a shared home:

- **Publish and version** — upload skill sources, release them with semantic
  versions, and keep full Git history behind every release.
- **Discover and install** — search by namespace, keyword, and visibility;
  install project-wide or globally with a single command.
- **Adapt to every AI tool** — write a skill once and link it into Claude Code,
  Codex, Cursor, Trae, WorkBuddy, OpenCode, OpenClaw, and Hermes through the
  Agent Skills standard.
- **Govern at organization scale** — organizations, teams, RBAC (read / write /
  manage), public or private visibility, and audit-friendly history.

## Quick start

### Requirements

- Node.js `20.17.x`, `22.x` (≥22.13), `23.5.x`, or `24.x` (24 recommended) —
  Node 25/26 are not supported.
- `git` on `PATH` (Git for Windows on Windows) for remote `esl skill use`,
  source workflows, and Git-backed installation fallbacks.
- No server, account, or Docker is needed to install the bundled
  `esl-operator` skill.

Full prerequisites, per-platform setup, and troubleshooting:
[CLI install guide](docs/guides/cli-install.md).

### Install the CLI

```bash
npm install -g @foxian/esl
esl --version
```

### Try the operator agent (offline)

`esl-operator` lets an AI tool drive ESL for you in natural language. It ships
inside the CLI, so this step needs no account, no Server, and no Git:

```bash
esl skill install -g @builtin/esl-operator --tools claude-code,codex
```

Then ask your AI tool: *"Use esl-operator to search the skill library for a code
review skill."*

### Explore the library

```bash
# Optional: point at your own instance instead of the public cloud default
esl config set-server https://your-esl-server.example

# Sign in (interactive; never put passwords on the command line)
esl account login
esl account whoami

# Search, inspect, and try a skill without installing it
esl skill search code-review
esl skill info @acme/code-review
esl skill use @acme/code-review

# Install it into the current project, or globally with -g
esl skill install @acme/code-review
esl skill install @acme/code-review -g --tools claude-code,codex

# List what is installed locally, update, or remove
esl list
esl skill update @acme/code-review
esl skill uninstall @acme/code-review
```

No account yet? Open `{server}/admin/register-user` in a browser — the CLI does
not create users. More commands, authoring and release workflows, and flag
references: [usage guide](docs/guides/usage.md).

## Built-in skills

The CLI ships two skills out of the box:

| Skill | Versioning | Purpose |
| --- | --- | --- |
| `@builtin/esl-operator` | Locked to the CLI version | Operate ESL from natural language: search, try, install, update, uninstall, manage tool links, and run source/publish workflows. |
| `@builtin/skill-forge` | Independent (1.0.0) | Create, edit, evaluate, and benchmark skills, and tune descriptions for better trigger accuracy. |

```bash
esl skill install -g @builtin/skill-forge --tools claude-code
```

## Supported AI tools

Skills are linked into tool-native directories (project `.<tool>/skills/` or
global `~/.<tool>/skills/`), using symlinks on Unix and directory junctions on
Windows:

`claude-code` · `codex` · `cursor` · `trae-intl` · `trae-cn` · `workbuddy` ·
`opencode` · `openclaw` · `hermes`

Use `--tools all` to link a skill into every installed tool, or
`esl config preferred-tools` to set a default.

## Self-hosting

ESL Server runs on a single Linux machine with Docker Compose. The server only
needs **Docker and git** — no Node.js. It binds no domain and publishes no host
port by default; expose the entry point the way your environment requires.

```bash
git clone https://github.com/foxian/enterprise-skill-library.git
cd enterprise-skill-library
cp .env.example .env        # set GITEA_ADMIN_PASSWORD and ESL_ENVIRONMENT=production
bash scripts/prod/deploy.sh # build images, wait for health, run smoke checks
```

The production configuration publishes no host port by default; expose the
entry point (reverse proxy, tunnel, or port mapping) the way your environment
requires. Domains, TLS, and tunnels are instance-level concerns and stay out of
this repository. Nightly backups:

```bash
bash scripts/prod/backup.sh --install-cron   # daily at 03:00, keeps 14 days
```

See [production deployment](docs/guides/production-deployment.md) for the full
runbook, backup/restore, and upgrade procedure.

## Architecture

ESL is an npm workspaces monorepo:

| Package | Description |
| --- | --- |
| `packages/cli` | `@foxian/esl`, the public CLI (commander). Bundles the core logic and built-in skills. |
| `packages/core` | Shared domain logic: manifests, versions, packaging, and validation. |
| `packages/i18n` | Localization resources (i18next) shared by server and CLI. |
| `packages/server` | Fastify API, SQLite database, and the internal Gitea Git backend. |
| `packages/web` | Vue 3 + Vite + Element Plus admin console and personal workspace. |

A deployment exposes one user-facing entry point: the web console and API at
`/api`, Git traffic at `/git`, and the admin UI at `/admin`.

## Local development

```bash
npm install
npm run build
docker compose up --build
```

The dev stack serves `http://localhost:4070` (`/admin`, `/api`, `/git`). Copy
`.env.example` to `.env` first and set `GITEA_ADMIN_PASSWORD`. Day-to-day
commands (`npm run reload:dev`, `npm run reset:dev`, `npm run deploy:web`) and
seeding are documented in the
[local development guide](docs/guides/local-development.md).

## Documentation

- [CLI install guide](docs/guides/cli-install.md) — Node setup, per-platform steps, first login
- [Usage guide](docs/guides/usage.md) — full command reference and workflows
- [Skill release lifecycle](docs/guides/skill-release-lifecycle.md)
- [Publishing the CLI](docs/guides/publishing-cli.md)
- [Local development](docs/guides/local-development.md)
- [Production deployment](docs/guides/production-deployment.md)
- [Platform support](docs/guides/platform-support.md)
- [Server logging](docs/guides/logging.md) · [Docker troubleshooting](docs/guides/docker-troubleshooting.md)
- [Domain context](CONTEXT.md)
- [Architecture decisions](docs/adr/) · [Product decisions](docs/decisions/)
- [CLI guidelines reference](docs/reference/command-line-interface-guidelines.md)

## Contributing

Issues and feature requests are tracked on
[GitHub](https://github.com/foxian/enterprise-skill-library/issues). Before
submitting a change, run:

```bash
npm test
npm run build
```

Changes to CLI commands, flags, or behavior must update the client-coupled
`skills/esl-operator/` skill in the same change.

## License

MIT — see [LICENSE](LICENSE).
