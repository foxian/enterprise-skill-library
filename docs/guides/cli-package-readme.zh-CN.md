# @foxian/esl（中文说明）

Enterprise Skill Library（ESL）命令行客户端：在企业内发现、安装、链接与发布 AI Agent 技能。

本包是 ESL 的**唯一公开 CLI 发行包**。**不**内置默认 Server 地址；需要你自己的 ESL Server（或本地开发实例）。

> npm 包页展示的是英文 [`packages/cli/README.md`](../../packages/cli/README.md)。本文仅在仓库中维护，**不**打进 npm 包，方便中文阅读。

**完整安装指南**（Windows / macOS / Ubuntu 前置、环境检查、首次登录）：[cli-install.md](cli-install.md)

## 要求

- Node.js：`20.17.x`、`22.x`（≥22.13）或 `24.x`（推荐 24）
- npm（随 Node 安装）
- 可访问的 ESL Server URL（发行包**无**出厂默认地址）
- 强烈建议本机 `PATH` 中有 Git（远端 `esl install` / 创作类命令会用到）

## 安装

```bash
node -v
npm -v
npm install -g @foxian/esl
esl --version
```

若安装后找不到 `esl`：新开终端，并确认 npm 全局 bin 目录在 `PATH` 中。分平台装 Node 与排障见 [cli-install.md](cli-install.md)。

## 快速开始

```bash
# 配置 Server（只需一次；也可用环境变量 ESL_SERVER）
esl config set-server https://your-esl-server.example

# 登录（交互输入用户名、密码；勿在命令行写明文密码）
esl login

# 确认身份
esl whoami

# 搜索 / 试用 / 安装技能
esl search keyword
esl use @scope/skill-name
esl install @scope/skill-name
```

本地 Docker 开发时，Server **常见**为 `http://localhost:3000`。这是本地开发约定，不是 CLI 出厂默认。

还没有账号？浏览器打开 `{server}/admin/register-user`（**CLI 不能注册用户**）。详见 [cli-install.md](cli-install.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `esl search` / `esl info` | 发现与查看技能 |
| `esl install` / `esl update` / `esl uninstall` | 安装、更新、卸载 |
| `esl link` / `esl adapt` / `esl tools list` | 链接到 Claude Code、Codex 等工具目录 |
| `esl init` / `esl upload` / `esl publish` | 创作并发布技能 |
| `esl --help` | 完整命令帮助 |

面向 Agent 的操作说明随包装有内置技能 `@builtin/esl-operator`（仅当该技能曾被显式安装过时，全局 `postinstall` 才会同步；**首次**仍需显式安装）。

## 文档与源码

- 仓库：https://github.com/foxian/enterprise-skill-library
- 安装指南（前置 / 首次登录）：`docs/guides/cli-install.md`
- 使用指南：`docs/guides/usage.md`
- 本地起 Server：`docs/guides/local-development.md`
- 变更记录：仓库根目录 `CHANGELOG.md`（随 Git / GitHub Release；**不**打进 npm tarball）
- 英文 README（npm 包页）：[`packages/cli/README.md`](../../packages/cli/README.md)

## License

MIT