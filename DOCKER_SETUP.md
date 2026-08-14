# Enterprise Skill Library Docker Setup

## 背景

这份文档记录本项目在 Windows + Docker Desktop 下启动本地运行环境的方式，以及之前 Docker 启动失败的原因和最终修复方案。

本说明参考了本机 Hermes skill 文档中的两类经验：

- `docker-desktop-china-network`: 国内网络、Docker Hub、npm registry、代理残留问题排查。
- `docker-nodejs`: Node.js monorepo、npm workspaces、TypeScript 构建的 Dockerfile 模式。

最终方案不是简单照抄参考文档，而是按本项目当前 `docker-compose.yml`、`.env.example` 和 `packages/server/Dockerfile` 落地。

## 环境要求

- Windows 10/11
- Docker Desktop 已启动
- Node.js 18+
- npm
- Git for Windows

当前方案不要求通过 WSL 执行 Docker 命令。

如果 Docker CLI 不在 `PATH` 中，可以直接使用：

```powershell
C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe
```

## 之前为什么启动不了

之前 Docker 启动失败主要是构建阶段的网络和 npm 环境问题，不是 API 服务代码本身不能运行。

### 1. 容器内不能访问宿主机的 `127.0.0.1:7897`

宿主机代理监听在 Windows 的 `127.0.0.1:7897`。但在 Docker build 容器里，`127.0.0.1` 指向容器自己，不是 Windows 宿主机。

所以如果 npm 在容器里尝试访问：

```text
127.0.0.1:7897
```

就会连接失败、超时，或者出现 npm 卡住的问题。

### 2. 直接访问 npm registry 也不稳定

清掉代理后，容器直接访问 `registry.npmmirror.com` 也可能因为本地网络、DNS 或代理软件状态而失败。

所以最终不能只依赖“关闭代理”或“清除代理变量”，需要给 Docker build 一个容器可访问的代理地址。

### 3. npm workspaces 构建需要正确安装依赖

本项目是 npm workspaces monorepo，API Dockerfile 需要安装并构建：

- `@esl/core`
- `@esl/server`

这部分参考了 Hermes `docker-nodejs` 文档里的 monorepo Dockerfile 模式。

## 当前采用的方案

当前 Dockerfile 支持构建参数：

```dockerfile
ARG NPM_PROXY=
```

Docker Compose 会从 `.env` 读取：

```dotenv
NPM_PROXY=
```

如果本机需要通过代理访问 npm registry，把 `.env` 里的值设置为：

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

`host.docker.internal` 是 Docker Desktop 提供给容器访问宿主机的地址。这样容器里的 npm 请求会访问 Windows 宿主机代理，而不是错误地访问容器自己的 `127.0.0.1`。

如果 Docker 容器可以直接访问 npm registry，则保持：

```dotenv
NPM_PROXY=
```

## 快速启动

在项目根目录执行：

```powershell
cd D:\DevProjects\enterprise-skill-library
Copy-Item .env.example .env
```

按本机网络情况编辑 `.env`：

```dotenv
GITEA_ADMIN_USERNAME=eslroot
GITEA_ADMIN_PASSWORD=replace-with-at-least-12-characters
GITEA_ADMIN_TOKEN_FILE=/bootstrap/gitea-admin-token
GITEA_REPO_OWNER=esl-skills
ESL_BOOTSTRAP_ADMIN_TOKEN=bootstrap-token
DATABASE_PATH=./data/esl.db
NPM_PROXY=http://host.docker.internal:7897
```

`GITEA_ADMIN_USERNAME` 默认使用 `eslroot`，因为 Gitea 1.22 会拒绝创建
保留用户名 `admin`。

启动服务：

```powershell
docker compose up -d --build
```

如果 Docker CLI 不在 `PATH` 中：

```powershell
& "C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose up -d --build
```

## 服务

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| ESL Server | `http://localhost:3000` | Enterprise Skill Library API and Git HTTP entry point |

首次启动时，`gitea-bootstrap` 会自动创建或复用 `GITEA_ADMIN_USERNAME`
对应的 Gitea 管理员，并把 API 使用的内部管理员 token 写入
`GITEA_ADMIN_TOKEN_FILE` 指向的共享 bootstrap secret volume。Docker 本地
运行不需要打开 Gitea UI，也不需要手工创建或复制 `GITEA_ADMIN_TOKEN`。
默认运行只暴露 ESL Server；需要直接访问 Gitea 进行恢复或诊断时，使用
`docker-compose.debug.yml` 覆盖文件。

`GITEA_ADMIN_PASSWORD` 只在首次创建 Gitea 管理员时使用。后续修改 `.env`
不会自动改 Gitea 密码；需要轮换恢复密码时，使用：

```powershell
npm exec -- esl admin gitea password --password-file .\new-password.txt
```

API 启动时会校验内部 Gitea 管理员 token，并确保 `GITEA_REPO_OWNER`
对应的组织存在。发布技能前不需要手工创建 `esl-skills` 组织。

如果使用其他组织名，需要同步修改 `.env`：

```dotenv
GITEA_REPO_OWNER=your-org-name
```

## 常用命令

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f gitea
docker compose logs gitea-bootstrap
docker compose restart api
docker compose down
docker compose down -v
docker compose build --no-cache api
docker compose up -d api gitea
```

## 初始化测试数据

```powershell
docker compose exec api npm run seed --workspace @esl/server
```

## CLI 验证

搜索 seeded skill：

```powershell
npm exec -- esl search my-skill --server http://localhost:3000
```

预期会返回类似：

```text
@myorg/my-skill  Sample seeded skill
```

查看详情：

```powershell
npm exec -- esl info @myorg/my-skill --server http://localhost:3000
```

登录本地 ESL Server：

```powershell
npm exec -- esl login --server http://localhost:3000 --username <user> --token-file .\user-token.txt
```

管理员首次登录使用 `ESL_BOOTSTRAP_ADMIN_TOKEN`：

```powershell
npm exec -- esl login --server http://localhost:3000 --username eslroot --token-file .\bootstrap-token.txt
npm exec -- esl admin bootstrap status
npm exec -- esl admin user create alice
npm exec -- esl admin user token alice
```

## Docker 镜像加速

如果拉取基础镜像失败，可以配置 Docker Desktop 镜像加速器。

编辑：

```text
C:\Users\<用户名>\.docker\daemon.json
```

示例：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://docker.nju.edu.cn",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
```

修改后重启 Docker Desktop。

验证：

```powershell
docker info
```

输出中应能看到 `Registry Mirrors`。

## 关键结论

- 之前失败的主要原因是容器内 npm 访问了错误的代理地址，或直连 registry 不稳定。
- `127.0.0.1:7897` 不能直接用于 Docker 容器内访问宿主机代理。
- Docker Desktop 下应使用 `host.docker.internal:7897`。
- Hermes 文档提供了排查方向，最终项目实现采用了 `NPM_PROXY` 构建参数。
- 当前项目启动文档应以 `docs/local-dev.md`、`.env.example`、`docker-compose.yml` 和 `packages/server/Dockerfile` 为准。
