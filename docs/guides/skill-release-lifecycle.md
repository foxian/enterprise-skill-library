# Skill Release Lifecycle Walkthrough

This walkthrough proves the server-backed project Skill Release lifecycle from a
fresh local Docker volume. It uses the ESL Server at `http://localhost:3000` for
normal user workflows. Gitea remains the internal Git Backend and is only needed
for diagnostics or recovery.

The walkthrough creates two ordinary Skill Users:

- `author` publishes Skill Releases.
- `consumer` discovers, installs, updates, and sources the Skill Release.

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
ESL_BOOTSTRAP_ADMIN_TOKEN=bootstrap-token
```

`GITEA_ADMIN_PASSWORD` must be at least 12 characters. The
`ESL_BOOTSTRAP_ADMIN_TOKEN` value is used only to perform the initial ESL
administrator login.

## 1. Start From A Fresh Volume

This removes the local Docker runtime state for ESL. Use it only when you are
intentionally resetting the local smoke environment.

```powershell
npm run build
docker compose down -v
docker compose up --build
```

Keep this terminal running. In a second terminal from the repository root, create
a scratch workspace and a bootstrap token file whose contents match
`ESL_BOOTSTRAP_ADMIN_TOKEN` in `.env`:

```powershell
New-Item -ItemType Directory -Force .scratch\smoke-workspace | Out-Null
Set-Content .scratch\smoke-workspace\bootstrap-token.txt bootstrap-token
```

## 2. Bootstrap The Platform

Log in as the ESL Administrator Account with the bootstrap token, then confirm
that Docker bootstrap is ready.

```powershell
npm exec -- esl login --server http://localhost:3000 --username eslroot --token-file .scratch\smoke-workspace\bootstrap-token.txt
npm exec -- esl admin bootstrap status
```

Create the two ordinary Skill Users and issue their login tokens:

```powershell
npm exec -- esl admin user create author
npm exec -- esl admin user token author | Set-Content .scratch\smoke-workspace\author-token.txt

npm exec -- esl admin user create consumer
npm exec -- esl admin user token consumer | Set-Content .scratch\smoke-workspace\consumer-token.txt
```

## 3. Author Publishes The First Release

Log in as `author`, initialize a skill, commit it, and publish version `0.1.0`.

```powershell
npm exec -- esl login --server http://localhost:3000 --username author --token-file .scratch\smoke-workspace\author-token.txt

Push-Location .scratch\smoke-workspace
npm exec -- esl init @author/demo
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

Log in as `consumer`, inspect the published Skill Release, then install it into
a project.

```powershell
npm exec -- esl login --server http://localhost:3000 --username consumer --token-file .scratch\smoke-workspace\consumer-token.txt
npm exec -- esl search demo
npm exec -- esl info @author/demo

New-Item -ItemType Directory -Force .scratch\smoke-workspace\consumer-project | Out-Null
Push-Location .scratch\smoke-workspace\consumer-project
npm exec -- esl install @author/demo --no-adapt
npm exec -- esl list
Pop-Location
```

The project should now contain `.skills.json`, `.skills-lock.json`, and
`.skills\@author\demo`.

## 5. Author Publishes A Patch Release

Log back in as `author`, make a source change, commit it, and publish the next
Skill Release. Source-form skills do not store a version locally; the SemVer is
passed directly to `esl publish`.

```powershell
npm exec -- esl login --server http://localhost:3000 --username author --token-file .scratch\smoke-workspace\author-token.txt

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
npm exec -- esl login --server http://localhost:3000 --username consumer --token-file .scratch\smoke-workspace\consumer-token.txt

Push-Location .scratch\smoke-workspace\consumer-project
npm exec -- esl update @author/demo
npm exec -- esl info @author/demo
Pop-Location

npm exec -- esl source @author/demo .scratch\smoke-workspace\source-copy
```

Expected result:

- `esl info @author/demo` lists `0.1.1` before `0.1.0`.
- `esl update @author/demo` reports `@author/demo: 0.1.0 -> 0.1.1`.
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
