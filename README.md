# Enterprise Skill Library

Enterprise Skill Library (ESL) is an enterprise platform for discovering,
sharing, and using AI Agent skills across teams.

> 已经有 Codex、Claude Code 等 AI 工具的新手用户，请从[从零安装 ESL CLI 并启用 `esl-operator`](docs/guides/cli-install.md)开始；首次访问远端技能库时再配置 Server 和登录。

未指定 Server 地址时，CLI 默认使用公开云端 `https://cloud.enterprise-skills.com/`；私有、自托管或本地开发实例可用 `--server`、`ESL_SERVER` 或 `esl config set-server` 覆盖。

## Requirements

- Node.js 20.17+ / 22.13+ / 23.5+ / 24.x for the CLI (`@foxian/esl`); 22+
  (recommend 24) for developing this repository. Node 25/26 are not
  supported.
- `git` on PATH (Git for Windows on Windows) — required for remote `skill use`,
  source workflows, and Git-backed installation fallbacks. Installing the local
  built-in `@builtin/esl-operator` does not require Git.
- Docker and Docker Compose to run ESL Server. The ESL CLI works on Windows,
  macOS, and Linux; the server is supported on Linux (T1) and via Docker
  Desktop on Windows (T2). See the
  [platform support matrix](docs/guides/platform-support.md).

## Local Development Quick Start

1. Install dependencies with `npm install`.
2. Run `npm run build`.
3. Follow the [local development guide](docs/guides/local-development.md) to
   start ESL Server.

## Documentation

- [CLI install guide](docs/guides/cli-install.md) (Windows / macOS / Ubuntu)
- [Usage guide](docs/guides/usage.md)
- [Local development](docs/guides/local-development.md)
- [Server logging](docs/guides/logging.md)
- [Docker troubleshooting](docs/guides/docker-troubleshooting.md)
- [Domain context](CONTEXT.md)
- [Architecture decisions](docs/adr/)
- [Product decisions](docs/decisions/)
- [CLI guidelines reference](docs/reference/command-line-interface-guidelines.md)
- [Superpowers records](docs/superpowers/)

## Development

Run `npm test` and `npm run build` before submitting code changes.
