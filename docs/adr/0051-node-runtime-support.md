# CLI 与 Server 分轨的 Node 运行时支持

Status: accepted

此前文档写 Node.js 18+，但 CLI 已依赖 `@inquirer/prompts` v8（不支持 18），Server 镜像仍停在已 EOL 的 Node 20。我们把「支持」定义成文档 + `engines` + CI matrix，并让 CLI 尽量宽、Server 与官方镜像跟 Active LTS。

## 决策

- **支持契约**：没进 CI matrix 的版本不承诺。不在运行时按 Node 版本硬退出，不设 `engine-strict`。能装上、能跑只表示未拦，不表示官方支持。
- **推荐版本**：整个项目推荐 **Node.js 24**（Active LTS）。官方 Docker 镜像与完整仓库开发默认跟 24；不钉 patch。
- **CLI**（终端用户）：官方支持 **20.17.x、22.x（≥22.13）、24.x**。`@foxian/esl` 的 `engines.node` 跟 Inquirer v8：`>=23.5.0 || ^22.13.0 || ^20.17.0`。不为 Node 18 降级 Inquirer。Node 26 安装可能不告警，但 **Current 不算支持**。
- **Server**：官方支持 **22.x、24.x**。`@esl/server` 与仓库根的 `engines.node` 为 `>=22`。`packages/server/Dockerfile` 与 `docker/web.Dockerfile` 构建阶段使用浮动标签 `node:24-bookworm-slim`（不钉 patch/digest；web 运行阶段仍是 nginx）。
- **共享包**：`@esl/core` / `@esl/i18n` 下限 `>=20.17.0`；`@esl/web` 不写运行时 `engines`。
- **CI**：本仓库 GitHub Actions 在 `pull_request` 与 `push` 到 `master` 上跑。CLI job：`20.17` / `22` / `24`。Server job：`22` / `24`。不测 18、不测 26。

## 考虑过的方案

- **为 Node 18 把 Inquirer 降到 v7**：扩大 CLI 覆盖，但与已选的 Inquirer v8 目标冲突，拒绝。
- **Server 继续 Node 20 / 镜像 `node:20-*`**：与当时 Dockerfile 一致，但 20 已于 2026-04-30 EOL，拒绝。
- **Server `engines` 写成 `^22 || ^24`**：把 23/25/26 挡在门外；改为 `>=22`，支持名单仍由 matrix 约束。
- **官方镜像跟 Node 26 Current**：太新、不进 matrix，拒绝。
- **Server 只认 24**：镜像已经是 24，但丢掉仍在 Maintenance 的 22 收益小，拒绝。
- **运行时检测或 `engine-strict`**：把「未测版本」变成硬失败，伤害终端用户，拒绝。

## 后果

- 贡献者开发完整仓库需要 Node ≥22（推荐 24）。只发布/使用 `@foxian/esl` 的终端用户可留在 20.17+。
- 生产镜像 Node 大版本随 `node:24-bookworm-slim` 浮动；原生模块（`better-sqlite3`）继续走 glibc/bookworm，不用 Node Alpine。
- `docs/qa-strategy.md` 中「当前无 CI」不再成立。版本数字不写入 `CONTEXT.md`。
