# Phase 3 本地运行环境设计

## 状态

已批准进入实施计划编写。

## 目标

Phase 3 的目标是把 Phase 2 已实现的 Server 和 CLI 代码推进到“本地真实可运行”的状态。这个阶段要证明：

- API Server 可以作为真实 HTTP 进程启动。
- 本地 Gitea 服务可以支持认证验证。
- 宿主机上的 CLI 可以调用本地服务完成 `login`、`search` 和 `info`。

本阶段不要求跑通真实的 `publish` 或 `install` 端到端 Git HTTP 工作流。这两条链路留到后续阶段处理。

## 范围

包含：

- 增加可运行的 `@esl/server` 进程入口。
- 增加用于本地开发的 Docker Compose 环境，包含 Gitea 和 API Server。
- 增加 API Server 健康检查接口。
- 增加基于环境变量的 Server 配置。
- 增加开发用 seed 脚本，用于写入确定性的技能元数据。
- 编写可以直接复制执行的本地 smoke workflow 文档。
- 验证 `login`、`search` 和 `info` 能访问本地服务。

不包含：

- 真实 `esl publish` 端到端 push 工作流。
- 真实 `esl install` 端到端 clone 工作流。
- Nginx 反向代理。
- HTTPS。
- 生产部署自动化。
- Gitea 首次启动时的账号自动初始化。

## 架构

Docker Compose 运行两个服务：

- `gitea`：本地 Gitea，用于用户/token 验证，并为后续 Git HTTP 工作流做准备。
- `api`：`@esl/server`，使用 SQLite 存储技能元数据，并通过 Gitea 验证 token。

CLI 在宿主机上通过 `npm exec -- esl ...` 运行。这样可以避免进入容器 shell 的额外摩擦，也更接近日常开发者验证 CLI 行为的方式。

API Server 从环境变量读取配置：

- `PORT`：HTTP 监听端口。未设置时默认使用 `3000`。
- `DATABASE_PATH`：SQLite 数据库路径。运行 Server 和 seed 脚本都需要它。
- `GITEA_URL`：API Server 调用 Gitea REST API 使用的基础 URL。运行 Server 必需。
- `GITEA_ADMIN_TOKEN`：API Server 进行仓库管理操作使用的管理员 token。虽然 Phase 3 不验证 publish，但运行时仍要求提供该变量。

## API Server 运行入口

`packages/server` 应提供 `src/server.ts` 作为运行入口。它负责：

- 读取并校验环境配置；
- 创建 `GiteaService`；
- 调用 `buildApp`；
- 在配置的端口上启动 Fastify；
- 输出简洁的启动日志；
- 在缺少必需配置时，用清晰错误信息退出。

`packages/server/package.json` 应增加 `start` 脚本，用于运行构建后的 Server 入口。如果符合现有仓库约定，可以增加开发脚本，但这不是本阶段必需项。

## 健康检查接口

增加 `GET /health`。

该接口返回一个很小的 JSON 响应，用于证明 HTTP 进程存活，例如：

```json
{
  "ok": true,
  "service": "esl-api"
}
```

`/health` 不应要求 Gitea 已初始化或可访问。它是进程健康检查，不是依赖服务 readiness 检查。

## Seed 脚本

增加一个仅用于本地 smoke 测试的开发 seed 脚本。脚本向 API SQLite 数据库写入确定性的元数据，其中包含一个 public 示例技能：

- name: `@myorg/my-skill`
- scope: `myorg`
- skillName: `my-skill`
- description: `Sample seeded skill`
- author: `dev`
- visibility: `public`
- gitRepoPath: `myorg/my-skill`
- version: `0.1.0`

seed 脚本必须是幂等的。重复运行时，应保持一条 skill 记录和一条 version 记录，不应因为唯一约束失败。

seed 脚本从环境变量读取 `DATABASE_PATH`。如果缺少 `DATABASE_PATH`，脚本应输出清晰错误并退出。

## 本地开发流程

目标流程：

```powershell
npm run build
docker compose up --build
npm run seed --workspace @esl/server
npm exec -- esl login --registry http://localhost:3000/api --git-base http://localhost:3001 --username <user> --token <token>
npm exec -- esl search my-skill --registry http://localhost:3000/api
npm exec -- esl info @myorg/my-skill --registry http://localhost:3000/api
```

Gitea 账号和 token 创建在本阶段可以保持手动操作。本地开发文档必须清楚说明需要完成哪些 Gitea 设置步骤。

如果 Docker Compose 把 Gitea 映射到不同的宿主机端口，文档中的 `--git-base` URL 必须与 Compose 文件保持一致。

## 错误处理

Server 启动：

- 缺少 `DATABASE_PATH`、`GITEA_URL` 或 `GITEA_ADMIN_TOKEN` 时，应在监听端口前失败。
- 错误信息应明确指出缺少哪个环境变量。

Seed：

- 缺少 `DATABASE_PATH` 时，应在访问数据库前失败。
- 数据库初始化或写入失败应表现为命令失败。

CLI：

- 现有 CLI 网络错误处理可以保持不变，除非本阶段验证暴露阻塞问题。
- 本阶段不做大范围 CLI 错误处理重构。

## 测试

增加聚焦的自动化测试，覆盖：

- Server 环境配置解析；
- `/health` 响应；
- seed 脚本幂等性；
- 可以在不绑定真实外部端口的情况下测试的 runtime wiring。

现有验证要求保持不变：

```powershell
npm test
npm run build
```

本阶段的手动 smoke 验证：

- Docker Compose 运行时，API Server 的 `/health` 有响应。
- seed 脚本能写入示例元数据。
- `esl search` 能返回 seeded skill。
- `esl info @myorg/my-skill` 能返回 seeded skill。
- 当指向本地 Gitea 且提供有效 token 或受支持的登录流程时，`esl login` 能保存本地配置。

## 后续阶段

下一阶段应把 smoke path 扩展到真实的 `publish` 和 `install`：

- 创建或复用 Gitea 仓库；
- 通过 Git HTTP push 技能内容；
- 解析版本；
- 通过 Git HTTP clone；
- 明确 remote 替换策略和 adaptation 策略。
