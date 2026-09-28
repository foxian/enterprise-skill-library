# @foxian/esl

Command-line client for the Enterprise Skill Library (ESL): discover, install, link, and publish AI Agent skills inside your organization.

This package is the **only public ESL CLI distribution**. It does **not** ship a default Server URL; you need your own ESL Server (or a local development instance).

Chinese guide (repo only): [cli-package-readme.zh-CN.md](https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-package-readme.zh-CN.md)

## Requirements

- Node.js: `20.17.x`, `22.x` (≥22.13), or `24.x` (24 recommended)
- A reachable ESL Server URL

## Install

```bash
npm install -g @foxian/esl
esl --version
```

## Quick start

```bash
# Configure the Server once (or set ESL_SERVER)
esl config set-server https://your-esl-server.example

# Interactive login (org / username / password). Do not put passwords on the CLI.
esl login

# Check identity
esl whoami

# Search / try / install a skill
esl search keyword
esl use @scope/skill-name
esl install @scope/skill-name
```

For local Docker development, the Server is often `http://localhost:3000`.

## Common commands

| Command | Purpose |
| --- | --- |
| `esl search` / `esl info` | Discover and inspect skills |
| `esl install` / `esl update` / `esl uninstall` | Install, update, uninstall |
| `esl link` / `esl adapt` / `esl tools list` | Link into Claude Code, Codex, and other tool directories |
| `esl init` / `esl upload` / `esl publish` | Author and publish skills |
| `esl --help` | Full command help |

Agent-oriented operating notes ship as the built-in skill `@builtin/esl-operator` (synced on global install via `postinstall`).

## Docs & source

- Repository: https://github.com/foxian/enterprise-skill-library
- Usage guide: `docs/guides/usage.md`
- Local Server setup: `docs/guides/local-development.md`
- Changelog: root `CHANGELOG.md` (for Git / GitHub Release; **not** included in this npm tarball)
- Chinese README (repo only): [`docs/guides/cli-package-readme.zh-CN.md`](../../docs/guides/cli-package-readme.zh-CN.md)

## License

MIT
