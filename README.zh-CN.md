# Enterprise Skill Library

[![CI](https://github.com/foxian/enterprise-skill-library/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/foxian/enterprise-skill-library/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@foxian/esl)](https://www.npmjs.com/package/@foxian/esl)
[![License: MIT](https://img.shields.io/npm/l/@foxian/esl)](LICENSE)

[English](README.md) | 简体中文

Enterprise Skill Library（ESL）是企业内部的 AI 技能市场：跨团队发布、发现、
安装和治理 AI Agent 技能。像 npm 一样简单，像 Git 一样可靠。支持 Claude Code、
Codex、Cursor、Trae、WorkBuddy 等 AI 工具。

## 官方网站

- **项目官网** — <https://www.enterprise-skills.com>：产品介绍、功能特性、架构说明与文档。
- **公开云端实例** — <https://cloud.enterprise-skills.com/>：CLI 默认使用的 Server。
  在该站点注册或登录，即可浏览并安装发布到公开技能库的技能。

未指定 Server 地址时，CLI 默认使用公开云端 `https://cloud.enterprise-skills.com/`。
使用私有、自托管或本地实例时，可通过 `--server`、环境变量 `ESL_SERVER` 或
`esl config set-server` 覆盖。

## 为什么需要 ESL

AI Agent 技能正在成为企业资产，但通常散落在各个仓库和聊天记录里。ESL 为它们
提供一个共同的家：

- **发布与版本管理** —— 上传技能源码，以语义化版本发布，每次发布都有完整的
  Git 历史可追溯。
- **发现与安装** —— 按命名空间、关键词和可见性搜索；一条命令即可安装到项目
  或全局。
- **适配所有 AI 工具** —— 技能只写一次，通过 Agent Skills 标准链接到 Claude
  Code、Codex、Cursor、Trae、WorkBuddy、OpenCode、OpenClaw 和 Hermes。
- **组织级治理** —— 组织、团队、RBAC（读 / 写 / 管理）、公开或私有可见性，
  以及可审计的历史记录。

## 快速开始

### 环境要求

- Node.js `20.17.x`、`22.x`（≥22.13）、`23.5.x` 或 `24.x`（推荐 24）——不支持
  Node 25/26。
- `PATH` 上有 `git`（Windows 使用 Git for Windows），用于远端 `esl skill use`、
  源码工作流和 Git 兜底安装。
- 安装内置 `esl-operator` 技能不需要 Server、账号或 Docker。

完整的前置条件、分平台安装和故障排查见
[CLI 安装指南](docs/guides/cli-install.md)。

### 安装 CLI

```bash
npm install -g @foxian/esl
esl --version
```

### 试用 operator 技能（可离线）

`esl-operator` 可以让 AI 工具用自然语言操作 ESL。它随 CLI 一同分发，因此这一步
不需要账号、Server 或 Git：

```bash
esl skill install -g @builtin/esl-operator --tools claude-code,codex
```

然后在 AI 工具中输入：*“请使用 esl-operator，帮我在 ESL 技能库里搜索一个代码
审查技能。”*

### 浏览技能库

```bash
# 可选：指向你自己的实例，而不是默认的公开云端
esl config set-server https://your-esl-server.example

# 登录（交互式；不要把密码写在命令行里）
esl account login
esl account whoami

# 搜索、查看并试用技能（不安装）
esl skill search code-review
esl skill info @acme/code-review
esl skill use @acme/code-review

# 安装到当前项目；加 -g 安装到全局
esl skill install @acme/code-review
esl skill install @acme/code-review -g --tools claude-code,codex

# 查看本地已安装的技能，更新或卸载
esl list
esl skill update @acme/code-review
esl skill uninstall @acme/code-review
```

还没有账号？在浏览器打开 `{server}/admin/register-user` 注册——CLI 不提供
注册功能。更多命令、技能编写与发布流程、参数说明见
[使用指南](docs/guides/usage.md)。

## 内置技能

CLI 自带两个技能：

| 技能 | 版本策略 | 用途 |
| --- | --- | --- |
| `@builtin/esl-operator` | 与 CLI 版本锁步 | 用自然语言操作 ESL：搜索、试用、安装、更新、卸载，管理工具链接，执行源码与发布流程。 |
| `@builtin/skill-forge` | 独立版本（1.0.0） | 创建、编辑、评测和基准测试技能，并优化描述以提升触发准确率。 |

```bash
esl skill install -g @builtin/skill-forge --tools claude-code
```

## 支持的 AI 工具

技能会链接到各工具的原生目录（项目级 `.<tool>/skills/` 或全局
`~/.<tool>/skills/`），Unix 使用符号链接，Windows 使用目录联接：

`claude-code` · `codex` · `cursor` · `trae-intl` · `trae-cn` · `workbuddy` ·
`opencode` · `openclaw` · `hermes`

使用 `--tools all` 可把技能链接到所有已安装工具，或用
`esl config preferred-tools` 设置默认工具。

## 自托管

ESL Server 在单台 Linux 机器上通过 Docker Compose 运行。服务器只需要
**Docker 和 git**，不需要 Node.js。默认不绑定域名，也不发布宿主机端口；入口
按你的实际环境暴露。

```bash
git clone https://github.com/foxian/enterprise-skill-library.git
cd enterprise-skill-library
cp .env.example .env        # 设置 GITEA_ADMIN_PASSWORD、ESL_ENVIRONMENT=production
bash scripts/prod/deploy.sh # 构建镜像、等待健康检查、执行冒烟测试
```

生产配置默认不发布宿主机端口，请按环境需要自行暴露入口（反向代理、隧道或
端口映射）。域名、TLS 和隧道属于实例层配置，不进入本仓库。每晚自动备份：

```bash
bash scripts/prod/backup.sh --install-cron   # 每天 03:00 执行，保留 14 天
```

完整的部署手册、备份恢复与升级流程见
[生产部署指南](docs/guides/production-deployment.md)。

## 架构

ESL 是一个 npm workspaces monorepo：

| 包 | 说明 |
| --- | --- |
| `packages/cli` | `@foxian/esl`，公开 CLI（commander），打包核心逻辑与内置技能。 |
| `packages/core` | 共享领域逻辑：清单、版本、打包与校验。 |
| `packages/i18n` | Server 与 CLI 共用的国际化资源（i18next）。 |
| `packages/server` | Fastify API、SQLite 数据库和内部 Gitea Git 后端。 |
| `packages/web` | Vue 3 + Vite + Element Plus 管理后台与个人工作台。 |

一次部署对外只有一个用户入口：Web 管理台与 API 位于 `/api`，Git 流量位于
`/git`，管理界面位于 `/admin`。

## 本地开发

```bash
npm install
npm run build
docker compose up --build
```

开发栈访问 `http://localhost:4070`（`/admin`、`/api`、`/git`）。首次运行请把
`.env.example` 复制为 `.env` 并设置 `GITEA_ADMIN_PASSWORD`。日常命令
（`npm run reload:dev`、`npm run reset:dev`、`npm run deploy:web`）和种子数据
见[本地开发指南](docs/guides/local-development.md)。

## 文档

- [CLI 安装指南](docs/guides/cli-install.md) —— Node.js 环境、分平台步骤、首次登录
- [使用指南](docs/guides/usage.md) —— 完整命令参考与工作流
- [技能发布生命周期](docs/guides/skill-release-lifecycle.md)
- [发布 CLI](docs/guides/publishing-cli.md)
- [本地开发](docs/guides/local-development.md)
- [生产部署](docs/guides/production-deployment.md)
- [平台支持](docs/guides/platform-support.md)
- [Server 日志](docs/guides/logging.md) · [Docker 故障排查](docs/guides/docker-troubleshooting.md)
- [领域术语](CONTEXT.md)
- [架构决策](docs/adr/) · [产品决策](docs/decisions/)
- [CLI 规范参考](docs/reference/command-line-interface-guidelines.md)

## 贡献

问题与功能请求通过 [GitHub](https://github.com/foxian/enterprise-skill-library/issues)
跟踪。提交改动前请运行：

```bash
npm test
npm run build
```

修改 CLI 命令、参数或行为时，必须在同一次改动中同步更新与客户端锁步的
`skills/esl-operator/` 技能。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
