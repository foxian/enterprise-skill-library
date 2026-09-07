# 本地开发运行时

本文是本地启动 ESL 的权威指南。关于 Docker Desktop、镜像仓库、代理或恢复问题，请参阅
[Docker 故障排查](docker-troubleshooting.md)。

## 前置条件

- Node.js 18+
- npm
- Docker Desktop
- Git for Windows

## 启动服务

将 `.env.example` 复制为 `.env`，至少配置以下必填项：

| 变量 | 必填 | 说明 |
|---|---|---|
| `GITEA_ADMIN_PASSWORD` | ✅ | 平台超级管理员（默认 `eslroot`）的初始密码，至少 12 个字符。用于登录管理后台（`http://localhost:3000/admin`），而非 CLI 登录。 |
| `ESL_APPLICATION_ENCRYPTION_KEY` | ✅ | 应用层加密密钥，64 个十六进制字符（256 位）。服务启动时校验，缺失会直接报错退出。可使用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成。 |

`GITEA_ADMIN_USERNAME` 默认为 `eslroot`；Gitea 1.22 在 bootstrap 用户创建时会拒绝保留用户名 `admin`。

### 部署模式与默认组织（ADR-0022）

ESL 支持两种部署模式，通过 `ESL_DEPLOYMENT_MODE` 声明，服务启动时自动 Bootstrap：

- **`multi`（默认）**：多组织模式，技能云提供商场景；不预置任何组织，通过注册申请开通。可选地成对声明 `ESL_DEFAULT_ORG` + `ESL_ORG_ADMIN_PASSWORD`，启动时自动开通该组织并设为默认组织。
- **`single`**：单组织模式，企业自部署场景；**必须**成对声明 `ESL_DEFAULT_ORG` 与 `ESL_ORG_ADMIN_PASSWORD`，启动时直接开通该组织并设为默认组织，不开放公开注册。

```dotenv
# 单组织模式示例
ESL_DEPLOYMENT_MODE=single
ESL_DEFAULT_ORG=acme
ESL_ORG_ADMIN_PASSWORD=your-org-admin-password-at-least-12-chars
```

单组织模式下，组织管理员初始用户名为 `org_admin`，登录时省略组织名即可（服务端按默认组织拼装账号）。平台超级管理员（`eslroot`）不受模式限制，始终可登录管理后台切换模式。

### 可选配置

如果 Docker 构建在代理网络下无法访问 npm 注册表，请在 `.env` 中设置 `NPM_PROXY` 为 Docker 可访问的宿主机代理地址。例如，Windows 上本地代理端口为 `7897` 时：

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

当 Docker 容器可以直接访问 npm 时，将 `NPM_PROXY` 留空。

关于 Docker 特定的网络诊断和镜像拉取恢复，请参阅
[Docker 故障排查](docker-troubleshooting.md)。

```powershell
npm run build
docker compose up --build
```

Gitea 作为 ESL 的内部 Git 后端运行。本地 Docker 运行时会锁定 Gitea 安装并禁用公开注册，因此正常的设置和用户入职通过 ESL 完成，而非 Gitea UI。

用户面向的 ESL 服务器地址是 `http://localhost:3000`。API 路由在 `/api` 下提供服务，
Git HTTP 流量在 `/git` 下路由，Web 管理后台（从 `packages/web` 构建）在
`/admin` 下提供服务——执行 `npm run build` 后在浏览器中打开
`http://localhost:3000/admin`，构建同时会生成挂载到 nginx 容器的 web 静态包。

`server`（nginx）容器会等待 `api` 容器健康检查通过后再启动，因此启动后即可直接访问，
不会出现冷启动 502 窗口。Nginx 的上传大小限制为 200 MB（`client_max_body_size 200m`）。

## 重新部署 Web 管理后台

前端不会被打包进任何镜像：`packages/web/dist` 以 bind mount 方式挂载到
nginx 容器。重新构建并重新部署：

```powershell
npm run deploy:web
```

该命令执行 `vite build`（它会就地更新 `dist` 中的文件——
`emptyOutDir: false` 保持目录 inode 稳定，因此容器的挂载永远不会失效）并重新创建
`server` 容器。只有重新创建的容器才会重新读取 `docker-compose.yml`，因此在修改
compose 配置或挂载后，使用 `docker compose up -d server`，切勿使用
`docker compose restart`。同样的注意事项适用于单文件挂载，如
`docker/nginx.conf`。

由于构建时不再清空 `dist`，先前构建的带哈希资源会累积；偶尔删除未使用的
`dist/assets/*` 文件即可。

API 服务器代码被打包进 `api` 镜像。修改 `packages/server` 下的代码需要执行
`docker compose build api && docker compose up -d api`。
Dockerfile 在依赖安装层之前复制工作区清单，因此仅代码变更会复用缓存的
`npm install` 层。

`gitea-bootstrap` 创建或复用配置的 Gitea 管理员，并将内部 Gitea 管理员令牌写入共享 bootstrap 密卷中的 `GITEA_ADMIN_TOKEN_FILE`。Docker 本地运行时不需要打开 Gitea UI 或手动创建 `GITEA_ADMIN_TOKEN`。

`GITEA_ADMIN_PASSWORD` 仅在首次运行时作为输入。在 bootstrap 之后修改 `.env`
中的该值不会轮换 ESL 管理员账号密码；请以配置的管理员账号登录管理后台，
通过右上角头像下拉菜单中的「修改密码」入口进行修改。

API 在开始监听之前会验证内部令牌。技能源仓库位于与 Gitea 组织映射的租户组织下
（参见 `docs/adr/0016`）；服务器在启动时不再断言固定的平台组织。

## 前后端单独更新命令速查

日常开发中，只需更新某一端时，使用对应的单独命令比全量 `reload:dev` 更快：

| 目标 | 命令 |
|---|---|
| **仅更新后端（API）** | `docker compose build api && docker compose up -d api` |
| **仅更新前端（Web 管理后台）** | `npm run build --workspace @esl/web`，然后刷新浏览器 |
| **前后端全部更新** | `npm run reload:dev` |

> 💡 前端更新不需要重启 Docker 容器——`packages/web/dist` 以 bind mount 方式挂载到 nginx，文件变更立即可见。后端代码打包在 `api` 镜像内，所以每次变更都要重建镜像并重启容器。

## 重新加载代码变更

编辑源代码后，通过以下任一命令让运行中的栈获取新代码：

```powershell
npm run reload:dev
```

该命令重新构建所有工作区包（`npm run build`）、重新构建 `api`
镜像，并重新创建 `api` 和 `server` 容器。Web 包是 bind mount，
因此前端变更只需刷新浏览器；重新创建 `server` 会重新读取挂载的配置，如
`docker/nginx.conf`。
如果你想要一个干净的环境，请改用 `npm run reset:dev`（参见
[重置环境](#重置环境)）。

### 各层变更对应的操作

| 你修改了 | 需要的命令 |
|---|---|
| `packages/server` | `docker compose build api && docker compose up -d api`（代码被打包进 `api` 镜像） |
| `packages/web` | `npm run build --workspace @esl/web`，然后刷新浏览器（`dist` 是 bind mount） |
| `packages/core` | 先重新构建它（`npm run build --workspace @esl/core`），然后按照上面的 server / web 行操作 |
| `packages/cli` | `npm run build --workspace @esl/cli`（本地 `esl` 符号链接指向此仓库） |
| `docker/nginx.conf` / `docker-compose.yml` / 挂载 | `docker compose up -d server`（重新创建会重新读取配置） |

`npm run reload:dev` 一次性覆盖以上所有情况，是日常使用的命令。

### 为什么不用 `docker compose up --build`？

`up --build` 只重新构建 Docker 镜像——它**不会**在宿主机上执行
`npm run build`，因此前端变更永远不会生效（nginx 继续提供陈旧的 `dist`）。
首次启动或修改 compose 配置后使用它；日常代码变更使用 `reload:dev`。

## 登录

CLI 仅供组织成员使用：`esl login` 需要 `--org <orgname>`
（或提示输入）并分别发送组织名和用户名；服务器组装并校验 `<orgname>_<username>`
账号。使用 `npm exec -- esl config set-server http://localhost:3000` 设置一次服务器
（或设置 `ESL_SERVER` 环境变量），然后：

```powershell
npm exec -- esl login --org acme --username alice
```

平台管理员不登录 CLI。打开管理后台 `http://localhost:3000/admin`，
使用 `GITEA_ADMIN_USERNAME`（默认 `eslroot`）和管理员密码登录。
使用 `npm exec -- esl whoami` 检查当前 CLI 登录状态（显示组织和角色）。

组织和成员管理已移至管理后台；CLI 仅保留面向开发者的命令。技能用户可以使用
`esl account change-password` 修改自己的密码。

## 本地技能命名空间

使用保留的 `@local` 命名空间存放尚未发布的本地或草稿技能：

```powershell
npm exec -- esl init @local/my-skill
npm exec -- esl validate .\my-skill
npm exec -- esl install .\my-skill
npm exec -- esl adapt
```

`@local/*` 技能可以在本地创建、安装和适配，但不能发布到共享服务器。
发布前，请将技能重命名为稳定的命名空间：

```text
@local/my-skill -> @cnfox/my-skill
```

或：

```text
@local/my-skill -> @platform/my-skill
```

命名空间是稳定技能标识的一部分。它不是当前所有者、创建者或维护者。

## 种子元数据

针对 Docker Compose 使用的 API 数据库路径运行种子脚本：

```powershell
docker compose exec api npm run seed --workspace @esl/server
```

种子脚本插入一个示例技能（`@myorg/my-skill` v0.1.0），并且是幂等的。
开发环境下，API 可以在启动时自动播种：在 `.env` 中设置 `ESL_AUTO_SEED=true`
（默认为 `false`，因此生产环境以干净数据库启动），然后执行
`docker compose up -d api` 使新值生效到容器中。

## 重置环境

开发或 E2E 运行后，持久化卷中会累积陈旧数据
（SQLite 数据库、Gitea 仓库/组织、bootstrap 密钥）。
将栈重置为干净、可开发的状态：

```powershell
npm run reset:dev
```

该命令停止 Docker 栈，删除 `data/api`、`data/gitea` 和 `data/secrets`
（交互式确认后，可用 `--yes` 跳过），通过首次运行初始化路径重新创建它们
（启动时创建 schema + `gitea-bootstrap`），等待 API 变为健康状态，
并默认重新播种示例技能。传递 `--no-seed` 可跳过重新播种。
脚本拒绝删除看起来不像 ESL 数据的数据目录，并且它永远不会自动运行——
重置本质上是破坏性的。参见 `docs/adr/0018` 了解重置为何采用这种方式。

重置会使 `~/.skill-library/` 下任何先前的 `esl login` 状态失效；
之后需要重新登录。只有三个数据卷子目录被删除：
`.env`、web 包和源代码树保持不变。

运行前的前置条件：

- Docker Desktop 必须正在运行。
- `.env` 中的 `GITEA_ADMIN_PASSWORD` 必须至少 12 个字符——
  `gitea-bootstrap` 容器会验证这一点，否则以非零状态退出，
  从而阻塞整个启动过程。此密码用于在重置后重新创建
  `eslroot` 管理员。
- `data/` 下任何不会被栈重新创建的内容都会被永久删除
  （例如 E2E 辅助工具 `data/esl-db-tool.cjs`，它在 git 忽略列表中）。
  如果还需要，请先备份。

## CLI 冒烟测试

```powershell
npm exec -- esl login --server http://localhost:3000 --org <orgname> --username <user>
npm exec -- esl search my-skill --server http://localhost:3000
npm exec -- esl info @myorg/my-skill --server http://localhost:3000
```

完整的发布、跨用户安装、更新和源码冒烟路径，请参阅
[技能发布生命周期演练](skill-release-lifecycle.md)。

如需直接暴露 Gitea 进行后端诊断或恢复，请使用调试覆盖运行 Docker：

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build
```

这会将 Gitea 映射到 `http://localhost:3001`；正常的 ESL 工作流应继续使用
`http://localhost:3000`。恢复工作流请参阅
[Docker 故障排查](docker-troubleshooting.md)。
