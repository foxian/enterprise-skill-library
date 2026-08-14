# Documentation Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a clear repository documentation hierarchy, move Superpowers
records into one location, and publish an entry-point README.

**Architecture:** The repository root supplies one public entry point. Current
guides live under `docs/guides/`; external reference material lives under
`docs/reference/`; all design specs and implementation plans live under
`docs/superpowers/`. ADRs, decisions, and `CONTEXT.md` retain their existing
ownership.

**Tech Stack:** Markdown, Git file moves, PowerShell, ripgrep.

## Global Constraints

- Keep `.scratch/` as the active local issue-tracker workspace.
- Preserve git history with `git mv` for tracked document moves.
- Do not change CLI, server, or Docker runtime behavior.
- Do not rewrite historical command examples in completed specs and plans.
- Do not stage `.scratch/docker-smoke-*`.

---

### Task 1: Move Documents Into Their Permanent Locations

**Files:**
- Create: `docs/guides/`
- Create: `docs/reference/`
- Move: `USAGE.md` to `docs/guides/usage.md`
- Move: `docs/local-dev.md` to `docs/guides/local-development.md`
- Move: `DOCKER_SETUP.md` to `docs/guides/docker-troubleshooting.md`
- Move: `docs/command-line-interface-guidelines.md` to
  `docs/reference/command-line-interface-guidelines.md`
- Move: every `docs/specs/*.md` file to `docs/superpowers/specs/`
- Move: every `docs/plans/*.md` file to `docs/superpowers/plans/`

**Interfaces:**
- Consumes: the current tracked Markdown files listed above.
- Produces: the canonical directories used by the README, active guides, and
  future Superpowers documents.

- [ ] **Step 1: Create destination directories**

Run:

```powershell
New-Item -ItemType Directory -Force docs/guides, docs/reference
```

Expected: both destination directories exist.

- [ ] **Step 2: Move active guides and the external reference with Git**

Run:

```powershell
git mv USAGE.md docs/guides/usage.md
git mv docs/local-dev.md docs/guides/local-development.md
git mv DOCKER_SETUP.md docs/guides/docker-troubleshooting.md
git mv docs/command-line-interface-guidelines.md docs/reference/command-line-interface-guidelines.md
```

Expected: Git reports four renames and the root no longer contains `USAGE.md`
or `DOCKER_SETUP.md`.

- [ ] **Step 3: Move legacy specs and plans with Git**

Run:

```powershell
Get-ChildItem docs/specs -File | ForEach-Object {
  git mv $_.FullName (Join-Path docs/superpowers/specs $_.Name)
}
Get-ChildItem docs/plans -File | ForEach-Object {
  git mv $_.FullName (Join-Path docs/superpowers/plans $_.Name)
}
```

Expected: `docs/specs/` and `docs/plans/` are empty and the moved files appear
as renames in `git status --short`.

- [ ] **Step 4: Verify file layout**

Run:

```powershell
Get-ChildItem docs/guides, docs/reference, docs/superpowers/specs, docs/superpowers/plans -File |
  Select-Object FullName
git status --short
```

Expected: every moved file is present exactly once and
`.scratch/docker-smoke-*` remains untracked.

### Task 2: Create Current Documentation Entry Points And Remove Guide Duplication

**Files:**
- Create: `README.md`
- Modify: `docs/guides/usage.md`
- Modify: `docs/guides/local-development.md`
- Modify: `docs/guides/docker-troubleshooting.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the canonical paths created in Task 1.
- Produces: one public entry point, one normal local-runtime guide, one
  Docker-specific troubleshooting guide, and valid agent instructions.

- [ ] **Step 1: Write `README.md`**

Include these sections in order:

```markdown
# Enterprise Skill Library

Enterprise Skill Library (ESL) is an enterprise platform for discovering,
sharing, and using AI Agent skills across teams.

## Quick Start

1. Install dependencies with `npm install`.
2. Run `npm run build`.
3. Follow [Local development](docs/guides/local-development.md) to start ESL
   Server.

## Documentation

- [Usage guide](docs/guides/usage.md)
- [Local development](docs/guides/local-development.md)
- [Docker troubleshooting](docs/guides/docker-troubleshooting.md)
- [Domain context](CONTEXT.md)
- [Architecture decisions](docs/adr/)
- [Product decisions](docs/decisions/)
- [Superpowers records](docs/superpowers/)

## Development

Run `npm test` and `npm run build` before submitting code changes.
```

- [ ] **Step 2: Make `usage.md` the CLI workflow guide**

Replace its local-Docker startup detail with a concise link to
`local-development.md`. Keep the login, administrator, skill consumer, skill
author, and multi-agent adaptation sections. Link Gitea UI recovery guidance
to `docker-troubleshooting.md` rather than duplicating debug-compose commands.

- [ ] **Step 3: Make `local-development.md` the normal local runtime guide**

Keep prerequisites, `.env` configuration, `npm run build`, normal
`docker compose up --build`, administrator onboarding, local namespace,
seeding, CLI smoke, and the single ESL Server URL. Add a link to
`docker-troubleshooting.md` directly after the `NPM_PROXY` explanation and a
short Gitea-debug link at the end.

- [ ] **Step 4: Reduce `docker-troubleshooting.md` to diagnosis and recovery**

Remove the duplicate quick-start, service table, CLI verification, seed-data,
and normal workflow sections. Retain Docker Desktop prerequisites, proxy
explanation, `NPM_PROXY=http://host.docker.internal:7897`, image mirror
configuration, diagnostic commands, direct-Gitea debug override, and the
administrator-password rotation command. Start with a link to
`local-development.md` for ordinary startup.

- [ ] **Step 5: Update `AGENTS.md`**

Replace the Docker setup link with:

```markdown
- Docker local runtime guidance lives in
  [docs/guides/local-development.md](docs/guides/local-development.md).
- Docker-specific diagnosis lives in
  [docs/guides/docker-troubleshooting.md](docs/guides/docker-troubleshooting.md).
```

- [ ] **Step 6: Review current-guide navigation**

Read `README.md` and the three guides in sequence. Confirm that:

```text
README -> local-development -> docker-troubleshooting
README -> usage
usage -> local-development or docker-troubleshooting only when needed
```

Expected: normal setup instructions appear only in `local-development.md`.

### Task 3: Verify The Documentation Migration And Publish It

**Files:**
- Verify: `README.md`
- Verify: `AGENTS.md`
- Verify: `docs/guides/*.md`
- Verify: `docs/reference/command-line-interface-guidelines.md`
- Verify: `docs/superpowers/specs/*.md`
- Verify: `docs/superpowers/plans/*.md`

**Interfaces:**
- Consumes: the final documentation hierarchy.
- Produces: verified repository navigation with no stale active-document links.

- [ ] **Step 1: Check active references**

Run:

```powershell
rg -n "USAGE\.md|DOCKER_SETUP\.md|docs/local-dev\.md" `
  README.md AGENTS.md docs/guides docs/agent-coding-principles.md docs/agents
```

Expected: no matches.

- [ ] **Step 2: Check the old record directories are empty**

Run:

```powershell
Get-ChildItem docs/specs, docs/plans -Force
```

Expected: no files are returned.

- [ ] **Step 3: Review staged changes and working tree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; all tracked documentation changes are
intentional; `.scratch/docker-smoke-*` is still untracked and unstaged.

- [ ] **Step 4: Commit and push the migration**

Run:

```powershell
git add README.md AGENTS.md docs
git commit -m "docs: consolidate documentation structure"
git push
```

Expected: the documentation migration is committed and `master` is synchronized
with `origin/master`.
