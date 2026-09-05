# Skill Release Lifecycle Walkthrough

This walkthrough proves the server-backed project Skill Release lifecycle from a
fresh local Docker volume. It uses the ESL Server at `http://localhost:3000` for
normal user workflows. Gitea remains the internal Git Backend and is only needed
for diagnostics or recovery.

The walkthrough uses one organization, `smoke`, with two members:

- `author` publishes Skill Releases.
- `consumer` discovers, installs, updates, and sources the Skill Release.

The published skill identity is `@smoke/demo` (the scope `smoke` is the
organization's Namespace).

## Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows
- A `.env` file created from `.env.example`

Set these values in `.env` before starting from a fresh volume:

```dotenv
GITEA_ADMIN_USERNAME=eslroot
GITEA_ADMIN_PASSWORD=change-this-admin-password
```

`GITEA_ADMIN_PASSWORD` must be at least 12 characters. It is the initial
password of the ESL Administrator Account, which signs in through the Admin
Console (`http://localhost:3000/admin`) — never through the CLI.

## 1. Start From A Fresh Volume

This removes the local Docker runtime state for ESL. Use it only when you are
intentionally resetting the local smoke environment.

```powershell
npm run build
docker compose down -v
docker compose up --build
```

Keep this terminal running.

## 2. Bootstrap The Platform

The platform administrator does not use the CLI. Open the Admin Console at
`http://localhost:3000/admin` in a browser and sign in as `eslroot` with the
`GITEA_ADMIN_PASSWORD` value from `.env`. The 平台概览 (Dashboard) shows the
bootstrap status.

### 2a. Create The Organization

In the Admin Console, register the organization `smoke` (or, if 平台设置 has
registration set to manual approval, approve the application from 注册审批).
Provisioning creates the organization and its administrator account `smoke_admin`
with a one-time initial password shown in the console — record it.

### 2b. Create The Members

Sign out of the platform administrator and sign in as `smoke_admin` (organization
`smoke`). In 成员管理 (Members), create two members:

- `author`
- `consumer`

Each member create returns a one-time initial password shown in the console —
record both.

## 3. Author Publishes The First Release

Log in as `author` (organization `smoke`) with the recorded password, initialize
a skill, commit it, and publish version `0.1.0`.

```powershell
npm exec -- esl login --server http://localhost:3000 --org smoke --username author

Push-Location .scratch\smoke-workspace
npm exec -- esl init @smoke/demo
Push-Location demo
git branch -M main
git add SKILL.md release.json
git commit -m "Initial demo skill"
npm exec -- esl upload --directory .
npm exec -- esl publish 0.1.0 --force
Pop-Location
Pop-Location
```

`esl publish` stores a clean ESL Server clone URL in the Git remote and sends
the Skill User Token through a Git HTTP authentication header. Tokens should not
appear in remotes, lockfiles, or normal command output.

## 4. Consumer Discovers And Installs

Log in as `consumer` (organization `smoke`), inspect the published Skill Release,
then install it into a project.

```powershell
npm exec -- esl login --server http://localhost:3000 --org smoke --username consumer
npm exec -- esl search demo
npm exec -- esl info @smoke/demo

New-Item -ItemType Directory -Force .scratch\smoke-workspace\consumer-project | Out-Null
Push-Location .scratch\smoke-workspace\consumer-project
npm exec -- esl install @smoke/demo --no-adapt
npm exec -- esl list
Pop-Location
```

The project should now contain `.skills.json`, `.skills-lock.json`, and
`.skills\@smoke\demo`.

## 5. Author Publishes A Patch Release

Log back in as `author`, make a source change, commit it, and publish the next
Skill Release. Source-form skills do not store a version locally; the SemVer is
passed directly to `esl publish`.

```powershell
npm exec -- esl login --server http://localhost:3000 --org smoke --username author

Push-Location .scratch\smoke-workspace\demo
git add SKILL.md release.json
git commit -m "Release 0.1.1"
npm exec -- esl publish 0.1.1 --force
Pop-Location
```

## 6. Consumer Updates And Sources

Log back in as `consumer`, update the project install, and clone the Skill Source
Repository to the fixed smoke target.

```powershell
npm exec -- esl login --server http://localhost:3000 --org smoke --username consumer

Push-Location .scratch\smoke-workspace\consumer-project
npm exec -- esl update @smoke/demo
npm exec -- esl info @smoke/demo
Pop-Location

npm exec -- esl source @smoke/demo .scratch\smoke-workspace\source-copy
```

Expected result:

- `esl info @smoke/demo` lists `0.1.1` before `0.1.0`.
- `esl update @smoke/demo` reports `@smoke/demo: 0.1.0 -> 0.1.1`.
- `.scratch\smoke-workspace\source-copy` contains the cloned skill source.

## Recovery Notes

Use [Docker troubleshooting](docker-troubleshooting.md) when Docker bootstrap,
Gitea readiness, or Git HTTP proxying fails. To expose the Gitea UI for
diagnostics, start the debug override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build
```

Gitea is then available at `http://localhost:3001`. Continue using
`http://localhost:3000` for normal ESL CLI workflows.
