# @foxian/esl

Command-line client for the Enterprise Skill Library (ESL): discover, install, link, and publish AI Agent skills inside your organization.

This package is the **only public ESL CLI distribution**. When no Server URL is supplied, it uses the public cloud Server `https://cloud.enterprise-skills.com/`. Use `--server`, `ESL_SERVER`, or `esl config set-server` for a private, self-hosted, or local instance.

Chinese guide (repo only): [cli-package-readme.zh-CN.md](https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-package-readme.zh-CN.md)

**Full install guide** (Windows / macOS / Ubuntu prerequisites, checks, first login — Chinese, repo only): [cli-install.md](https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md)

## Requirements

- Node.js: `20.17.x`, `22.x` (≥22.13), or `24.x` (24 recommended)
- npm (ships with Node.js)
- A reachable ESL Server URL for remote operations; the public cloud default is used when none is supplied
- Git strongly recommended on `PATH` before remote `esl skill install` / authoring commands

## Install

```bash
node -v
npm -v
npm install -g @foxian/esl
esl --version
```

For a globally installed CLI, normal commands may report a newer stable version once per day. Upgrade interactively with:

```bash
esl self-update
```

Disable the background check with `esl config set cli-update-check false`. Project installs and `npx` executions are never modified by this check; use an explicit version such as `npx --yes @foxian/esl@0.2.0` for reproducible runs.

The check state is stored in the user-level config file (`%USERPROFILE%\\.eslib\\config.json` on Windows, `~/.eslib/config.json` on macOS/Linux), not in the project directory.

If `esl` is not found after install, open a new terminal and confirm the npm global bin directory is on your `PATH`. Platform-specific Node setup and troubleshooting: [cli-install.md](https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md).

## Quick start

```bash
# Optional: override the public cloud default for a private or self-hosted Server
esl config set-server https://your-esl-server.example

# Interactive login (username / password). Do not put passwords on the CLI.
esl account login

# Check identity
esl account whoami

# Search / try / install a skill
esl skill search keyword
esl skill use @scope/skill-name
esl skill install @scope/skill-name
```

If no address is configured, remote commands use `https://cloud.enterprise-skills.com/`. For local Docker development, the Server is often `http://localhost:4070`; that is a local-dev override, not the public default.

Each ESL Server instance has a stable Instance ID. `esl config server list` shows registered instances/addresses, `esl config server add <url>` registers a fallback address, `esl config server use <instance-id-or-url>` selects the current instance, and `esl config server remove` deletes only the local registration. A new address claiming an already-known Instance ID requires explicit confirmation (`--accept-new-address` in non-interactive use); an address that changes identity fails closed.

No account yet? Open `{server}/admin/register-user` in a browser (CLI cannot register users). Details: [cli-install.md](https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md).

## Common commands

| Command | Purpose |
| --- | --- |
| `esl skill search` / `esl skill info` | Discover and inspect skills |
| `esl skill install` / `esl skill update` / `esl skill uninstall` | Install, update, uninstall |
| `esl link` / `esl skill list` | Link a local source into the store; list installed skills and tool-link status |
| `esl source init` / `esl source upload` / `esl release publish` | Author and publish skills |
| `esl --help` | Full command help |

Agent-oriented operating notes ship as the built-in skill `@builtin/esl-operator` (synced on global install via `postinstall` **only if** that skill was already installed once; first-time install is still explicit).

## Docs & source

- Repository: https://github.com/foxian/enterprise-skill-library
- Install guide (prerequisites / first login): `docs/guides/cli-install.md`
- Usage guide: `docs/guides/usage.md`
- Local Server setup: `docs/guides/local-development.md`
- Changelog: root `CHANGELOG.md` (for Git / GitHub Release; **not** included in this npm tarball)
- Chinese README (repo only): [`docs/guides/cli-package-readme.zh-CN.md`](../../docs/guides/cli-package-readme.zh-CN.md)

## License

MIT
