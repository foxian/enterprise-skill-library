# ESL Gitolite → Gitea 迁移设计规格

> **版本**: 1.0.0-draft
> **日期**: 2026-07-28
> **状态**: 待审阅
> **前置文档**: [ESL 设计规格文档 v1.0.0](./2026-07-27-enterprise-skill-library-design.md)

---

## 目录

1. [概述](#1-概述)
2. [整体架构](#2-整体架构)
3. [认证与用户流程](#3-认证与用户流程)
4. [权限模型与 Gitea 映射](#4-权限模型与-gitea-映射)
5. [核心工作流变化](#5-核心工作流变化)
6. [数据模型变化](#6-数据模型变化)
7. [Gitea 集成](#7-gitea-集成)
8. [部署架构](#8-部署架构)
9. [对现有代码的影响](#9-对现有代码的影响)
10. [原设计文档受影响章节](#10-原设计文档受影响章节)

---

## 1. 概述

### 1.1 变更目的

将 ESL 的 Git 托管层从 Gitolite 迁移到 Gitea，同时将 Git 操作协议从 SSH 统一为 HTTP。

### 1.2 变更动机

- **Gitolite 太原始**：配置权限需要直接操作 `gitolite-admin` 仓库，维护成本高
- **Gitea 功能更全**：自带 Web UI、REST API、组织管理、Issue/PR 等现代功能
- **统一 HTTP 协议**：避免 SSH Key 管理的复杂性，对企业防火墙/代理更友好
- **减少双系统同步**：用户、组织、权限全部收归 Gitea，API Server 不再维护用户表和权限表

### 1.3 设计方案选型

评估了三种方案后选定 **方案 B：Gitea 承担更多**：

| 方案 | 描述 | 结论 |
|------|------|------|
| A. Gitea 仅替代 Gitolite | API Server 仍是核心中枢，Gitea 只做仓库托管 | ❌ 换汤不换药，双系统同步痛点未解 |
| **B. Gitea 承担更多** | **Gitea 管用户/组织/权限，API Server 只做技能市场增强层** | **✅ 选定** |
| C. 完全基于 Gitea | 去掉 API Server，CLI 直接调 Gitea API | ❌ 丧失搜索/适配/版本解析能力 |

### 1.4 技术栈变化

| 组件 | 原设计 | 新设计 | 变化类型 |
|------|--------|--------|----------|
| Git 托管 | Gitolite 3 | Gitea | **替换** |
| Git 协议 | SSH (:22) | HTTP (:80) | **替换** |
| 反向代理 | 无（V1）/ Nginx（后续） | Nginx（V1 即引入） | **提前引入** |
| 用户管理 | API Server SQLite | Gitea 内置 | **迁移** |
| 权限管理 | API Server + Gitolite 双系统 | Gitea 单系统 | **简化** |
| API Server | Fastify（全功能） | Fastify（轻量化） | **瘦身** |
| 数据库 | SQLite（用户+技能+权限） | SQLite（仅技能元数据） | **瘦身** |
| CLI / 测试框架 | esl / Vitest | esl / Vitest | 不变 |

---

## 2. 整体架构

### 2.1 架构图

```
                   skills.company.com (或 IP:80)
                          │
                     ┌────┴────┐
                     │  Nginx   │
                     │  :80     │
                     └────┬────┘
                          │
             ┌────────────┼──────────────┐
             │            │              │
         /api/*       /git/*         /gitea/*
             │            │          (Web UI)
             ▼            ▼              ▼
       ┌──────────┐  ┌──────────────────────┐
       │ Fastify   │  │       Gitea          │
       │ API Server│  │  (Git HTTP + Web UI  │
       │ :3000     │  │   + REST API)        │
       │           │  │   :3001              │
       └─────┬─────┘  └──────────┬──────────┘
             │                   │
        ┌────┴────┐      ┌──────┴──────┐
        │ SQLite  │      │ Git Repos   │
        │ (元数据  │      │ + Gitea DB  │
        │  索引)  │      │ (SQLite)    │
        └─────────┘      └─────────────┘
```

### 2.2 组件职责

| 组件 | 职责 |
|------|------|
| **Nginx** | 统一入口，路由分发（`/api/*` → API Server，`/git/*` → Gitea），后续可加 HTTPS |
| **Gitea** | 用户管理、Git 仓库托管（HTTP）、组织/权限管理、Web UI |
| **API Server (Fastify)** | 技能市场增强层：元数据索引、搜索、版本范围解析、多工具适配引擎 |
| **SQLite (API Server)** | 技能元数据缓存/索引，用于快速搜索。不再存储用户和权限 |

### 2.3 数据流向

1. **发布**：CLI → API Server（注册元数据 + 通过 Gitea API 创建仓库）→ CLI 通过 HTTP 执行 `git push` 到 Gitea
2. **安装**：CLI → API Server（查询元数据 + 版本解析）→ CLI 通过 HTTP 执行 `git clone` 从 Gitea → 本地适配
3. **搜索**：CLI → API Server（SQLite 全文搜索）
4. **认证**：CLI → Gitea API（用户名密码换 token）→ token 同时用于 API Server 和 Git HTTP

### 2.4 CLI 双通道通信

CLI 同时与两个服务通信：

| 操作 | 目标服务 | 协议 | 说明 |
|------|---------|------|------|
| 登录 | Gitea | HTTP | 用户名密码换 token |
| 搜索、元数据查询 | API Server | HTTP | 技能索引、版本解析 |
| 发布元数据 | API Server | HTTP | 注册/更新技能信息 |
| Git clone/push | Gitea | HTTP (Git) | 直接走 Gitea，不经过 API Server |

---

## 3. 认证与用户流程

### 3.1 登录流程

```
用户                CLI (esl)              Gitea              API Server
 │                    │                     │                    │
 │  esl login         │                     │                    │
 │───────────────────►│                     │                    │
 │                    │                     │                    │
 │  输入用户名+密码   │  POST /api/v1/users/{user}/tokens        │
 │◄──────────────────►│  (Basic Auth)       │                    │
 │                    │────────────────────►│                    │
 │                    │◄────────────────────│                    │
 │                    │  返回 Gitea token    │                    │
 │                    │                     │                    │
 │                    │  token 存入本地      │                    │
 │                    │  ~/.skill-library/  │                    │
 │                    │    config.json      │                    │
 │  登录成功 ✓        │                     │                    │
 │◄───────────────────│                     │                    │
```

CLI 调用 Gitea 的 `POST /api/v1/users/{username}/tokens` 接口，使用 HTTP Basic Auth（用户名+密码），换取一个 Personal Access Token。

### 3.2 Token 的双重用途

同一个 Gitea token 用于两个场景：

1. **Git HTTP 认证** — `git clone http://server/git/org/skill.git` 时，CLI 自动注入 Git credential（`http://<token>@server/git/...` 或通过 credential helper）
2. **API Server 请求** — `esl search`、`esl publish` 等请求 API Server 时，header 带 `Authorization: token <gitea-token>`

### 3.3 API Server 身份验证

API Server 不维护用户表，每次通过 Gitea 验证用户身份：

```
CLI ──── Authorization: token xxx ────► API Server
                                           │
                                           │ GET /api/v1/user
                                           │ (携带同一个 token)
                                           ▼
                                         Gitea
                                           │
                                           │ 返回用户信息（用户名、ID、邮箱等）
                                           ▼
                                      API Server 确认身份，处理业务逻辑
```

> API Server 可对验证结果加短期缓存（如 5 分钟），减少对 Gitea 的请求频率。

### 3.4 本地配置文件

```jsonc
// ~/.skill-library/config.json
{
  "registry": "http://skills.company.com/api",   // API Server（经 Nginx）
  "gitBase": "http://skills.company.com/git",    // Gitea Git HTTP（经 Nginx）
  "token": "gitea_xxxxxxxxxxxxxxxx",             // Gitea token，API 和 Git 两用
  "username": "zhangsan"
}
```

与原设计的变化：
- ❌ 去掉所有 SSH Key 相关配置
- ✅ 新增 `gitBase` — Gitea Git HTTP 基础 URL
- ✅ `token` 改为 Gitea Personal Access Token

### 3.5 用户注册

V1 用户直接在 Gitea Web UI 注册账号（或由管理员在 Gitea 中创建）。`esl login` 只做登录换 token，不负责注册。

---

## 4. 权限模型与 Gitea 映射

### 4.1 Scope 映射（GitHub 模式）

技能的 scope（`@scope/skill-name`）直接映射到 Gitea 的用户/组织结构：

| 技能标识 | Gitea 映射 | 仓库位置 |
|----------|-----------|---------|
| `@zhangsan/my-helper` | Gitea 用户 `zhangsan` | `zhangsan/my-helper` |
| `@frontend-team/code-review` | Gitea 组织 `frontend-team` | `frontend-team/code-review` |

### 4.2 V1 权限模型

| 业务概念 | Gitea 映射 | 说明 |
|----------|-----------|------|
| **public 技能** | Gitea public repo | 所有人可见、可 clone |
| **private 技能** | Gitea private repo | 仅 owner 和 collaborator 可见 |
| **技能作者 (admin)** | Repo owner 或 collaborator (write) | 可 push、管理仓库设置 |
| **普通用户 (read/use)** | Gitea 默认权限 | public repo 任何登录用户可 clone |

权限完全交给 Gitea 管理，API Server 不维护权限表。

### 4.3 V2 团队权限演进

| 业务概念 | Gitea 映射 |
|----------|-----------|
| **团队 scope** | Gitea Organization |
| **团队成员** | Org member / Team member |
| **团队可见性** | Org 下的 private repo + Team 读权限 |
| **精细权限** | Gitea Team 的 read/write/admin 权限 |

V2 不需要自建权限系统，直接复用 Gitea 的 Organization → Team → Repository 权限体系。

### 4.4 与原设计的对比

| 维度 | 原设计 (Gitolite) | 新设计 (Gitea) |
|------|-------------------|----------------|
| 权限配置方式 | 修改 `gitolite.conf` + git push | 调用 Gitea REST API |
| 用户添加 | 复制 SSH 公钥到 `keydir/` | Gitea Web UI 注册 |
| 团队管理 | Gitolite `@group` | Gitea Organization + Team |
| 可见性控制 | API Server 业务层校验 | Gitea repo public/private |
| 权限来源 | 双系统（Gitolite + API Server SQLite） | 单系统（Gitea） |

---

## 5. 核心工作流变化

### 5.1 发布流程 (`esl publish`)

```
CLI                        API Server                  Gitea
 │                            │                          │
 │  POST /api/skills          │                          │
 │  (skill.json 元数据)       │                          │
 │───────────────────────────►│                          │
 │                            │  检查仓库是否存在          │
 │                            │  GET /api/v1/repos/{owner}/{repo}
 │                            │─────────────────────────►│
 │                            │◄─────────────────────────│
 │                            │                          │
 │                            │  若不存在，创建仓库        │
 │                            │  POST /api/v1/orgs/{org}/repos
 │                            │  或 /api/v1/user/repos   │
 │                            │  (用管理员 token)         │
 │                            │─────────────────────────►│
 │                            │◄─────────────────────────│
 │                            │                          │
 │                            │  添加用户为 collaborator   │
 │                            │  PUT /api/v1/repos/{owner}/{repo}/collaborators/{user}
 │                            │─────────────────────────►│
 │                            │                          │
 │                            │  注册/更新元数据到 SQLite   │
 │  返回 Git 仓库地址          │                          │
 │◄───────────────────────────│                          │
 │                            │                          │
 │  git remote add + git push (HTTP, 用 Gitea token 认证) │
 │───────────────────────────────────────────────────────►│
 │                            │                          │
 │  git tag v1.0.0 + git push --tags                     │
 │───────────────────────────────────────────────────────►│
 │                            │                          │
 │  POST /api/skills/{name}/versions (通知版本发布)       │
 │───────────────────────────►│                          │
 │                            │  记录版本到 SQLite         │
 │  发布成功 ✓                 │                          │
 │◄───────────────────────────│                          │
```

与原设计的变化：用 Gitea REST API 替代操作 `gitolite-admin` 仓库，不再需要锁机制和 conf 文件生成。

### 5.2 安装流程 (`esl install`)

```
CLI                        API Server                  Gitea
 │                            │                          │
 │  GET /api/skills/{name}    │                          │
 │  ?version=^1.2.0           │                          │
 │───────────────────────────►│                          │
 │                            │  查 SQLite，解析版本范围   │
 │                            │  确定最佳匹配版本          │
 │  返回: 版本=1.3.2           │                          │
 │  Git 地址 + 适配信息        │                          │
 │◄───────────────────────────│                          │
 │                            │                          │
 │  git clone --branch v1.3.2 (HTTP, 用 Gitea token 认证) │
 │───────────────────────────────────────────────────────►│
 │                            │                          │
 │  本地适配（转换为目标工具格式）│                          │
 │  安装完成 ✓                 │                          │
```

与原设计的变化：`git clone` 从 SSH 改为 HTTP，其他逻辑不变。

### 5.3 搜索流程 (`esl search`)

不变——仍然走 API Server 的 SQLite 索引搜索，Gitea 不参与。

### 5.4 登录流程 (`esl login`)

```bash
$ esl login
? Registry: http://skills.company.com   # 首次需要输入，后续记住
? Username: zhangsan
? Password: ********
✓ 登录成功，token 已保存到 ~/.skill-library/config.json
```

与原设计的变化：去掉 SSH Key 注册步骤，只需用户名密码换 token。

---

## 6. 数据模型变化

### 6.1 去掉的表

| 表 | 原用途 | 去掉原因 |
|----|--------|---------|
| `users` | 存储用户信息（用户名、邮箱、SSH Key 等） | 用户信息由 Gitea 管理 |
| `permissions` | 存储技能权限映射 | 权限由 Gitea 仓库权限管理 |
| `ssh_keys` | 存储用户 SSH 公钥 | 不再使用 SSH 协议 |

### 6.2 保留的表

| 表 | 用途 |
|----|------|
| `skills` | 技能元数据（名称、描述、标签、仓库路径等） |
| `skill_versions` | 版本记录（版本号、发布时间、兼容性信息） |
| `skill_tags` | 标签索引（用于搜索） |

### 6.3 字段变化

```sql
-- skills 表中 git_repo_path 的格式变化
-- 旧: git@server:org/skill-name.git (SSH 格式)
-- 新: owner/repo-name (Gitea owner/repo 格式，运行时拼接 gitBase URL)

-- 示例:
-- 旧: git@192.168.1.100:myorg/debugging-helper.git
-- 新: myorg/debugging-helper
```

---

## 7. Gitea 集成

本章替代原设计文档的 §9 Gitolite 集成。

### 7.1 集成方式

API Server 通过 Gitea REST API（使用管理员 token）管理仓库和权限，不再需要操作 Git 配置仓库。

### 7.2 API Server 的 Gitea 管理员 Token

API Server 启动时需要配置一个 Gitea 管理员账户的 Personal Access Token，用于：

1. 创建仓库（为用户或组织创建 skill 仓库）
2. 管理 collaborator（添加/移除仓库协作者）
3. 查询用户信息（验证 CLI 传来的 token 对应的用户身份）
4. 管理组织和团队（V2）

### 7.3 关键操作的 Gitea API 映射

#### 创建新技能仓库

```
# 个人 scope
POST /api/v1/admin/users/{username}/repos
{
  "name": "debugging-helper",
  "private": false,           // public 技能
  "description": "..."
}

# 组织 scope
POST /api/v1/orgs/{org}/repos
{
  "name": "debugging-helper",
  "private": false,
  "description": "..."
}
```

#### 添加协作者

```
PUT /api/v1/repos/{owner}/{repo}/collaborators/{username}
{
  "permission": "write"
}
```

#### 验证用户 Token

```
GET /api/v1/user
Authorization: token <user-token>

# 返回用户信息（用户名、ID、邮箱等）
```

#### 检查仓库权限

```
GET /api/v1/repos/{owner}/{repo}
Authorization: token <user-token>

# 如果用户有权限则返回仓库信息，否则 404
```

### 7.4 GiteaService 设计

API Server 中新增 `GiteaService`，替代原设计的 `GitoliteAdminService`：

```typescript
interface GiteaService {
  // 仓库管理
  createRepo(owner: string, name: string, isPrivate: boolean): Promise<GiteaRepo>;
  getRepo(owner: string, name: string): Promise<GiteaRepo | null>;
  deleteRepo(owner: string, name: string): Promise<void>;

  // 协作者管理
  addCollaborator(owner: string, repo: string, username: string, permission: string): Promise<void>;
  removeCollaborator(owner: string, repo: string, username: string): Promise<void>;

  // 用户验证
  validateToken(token: string): Promise<GiteaUser | null>;

  // 组织管理（V2）
  createOrg(name: string): Promise<GiteaOrg>;
  addTeamMember(orgName: string, teamName: string, username: string): Promise<void>;
}
```

与原 `GitoliteAdminService` 的对比：

| 维度 | GitoliteAdminService | GiteaService |
|------|---------------------|--------------|
| 通信方式 | SSH + Git 操作 | HTTP REST API |
| 原子性 | 需要自建锁机制 | Gitea API 本身是原子的 |
| 错误处理 | 需要 Git 回滚 | HTTP 状态码，天然幂等 |
| 复杂度 | 高（操作文件 + Git commit/push） | 低（标准 HTTP 调用） |

---

## 8. 部署架构

### 8.1 Docker Compose 部署（推荐）

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ─── Nginx 反向代理（统一入口）───
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
      - gitea

  # ─── API Server（技能市场增强层）───
  api:
    build: ./packages/server
    expose:
      - "3000"
    volumes:
      - db-data:/app/data
    environment:
      - DATABASE_PATH=/app/data/esl.db
      - GITEA_URL=http://gitea:3000          # Gitea 内部通信地址
      - GITEA_ADMIN_TOKEN=${GITEA_ADMIN_TOKEN}  # Gitea 管理员 token
    depends_on:
      - gitea

  # ─── Gitea（Git 仓库 + 用户管理 + Web UI）───
  gitea:
    image: gitea/gitea:latest
    expose:
      - "3000"
    volumes:
      - gitea-data:/data
    environment:
      - GITEA__database__DB_TYPE=sqlite3
      - GITEA__server__ROOT_URL=http://skills.company.com/git/
      - GITEA__server__HTTP_PORT=3000

volumes:
  db-data:       # API Server SQLite 数据持久化
  gitea-data:    # Gitea 数据持久化（仓库 + 数据库 + 配置）
```

#### Nginx 配置

```nginx
server {
    listen 80;

    # API Server
    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Gitea Git HTTP（仓库 clone/push）
    location /git/ {
        proxy_pass http://gitea:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100m;     # Git push 可能有大文件
    }

    # Gitea Web UI（管理用）
    location /gitea/ {
        proxy_pass http://gitea:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Docker Compose 架构图

```
Docker Compose
┌──────────────────────────────────────────┐
│                                          │
│  ┌─────────┐                             │
│  │ nginx   │ :80 (对外唯一端口)           │
│  └────┬────┘                             │
│       │                                  │
│   ┌───┴────────────────┐                 │
│   │         │          │                 │
│   ▼         ▼          ▼                 │
│ /api/*   /git/*    /gitea/*              │
│   │         │          │                 │
│   ▼         ▼──────────▼                 │
│ ┌─────┐  ┌────────────────┐              │
│ │ api  │  │     gitea      │              │
│ │:3000 │  │     :3000      │              │
│ └──┬───┘  └──────┬─────────┘              │
│    │             │                       │
│ ┌──┴───┐  ┌─────┴──────┐                │
│ │SQLite│  │ gitea-data  │                │
│ │volume│  │   volume    │                │
│ └──────┘  └────────────┘                 │
└──────────────────────────────────────────┘
```

### 8.2 手动部署 — Linux 服务器

#### 前置要求

- Linux 服务器（Ubuntu 22.04+ / CentOS 8+ 推荐）
- Node.js 18+
- Git 2.x
- Nginx

#### 安装步骤

```bash
# 1. 安装 Gitea
wget -O /usr/local/bin/gitea https://dl.gitea.com/gitea/latest/gitea-linux-amd64
chmod +x /usr/local/bin/gitea
# 创建 gitea 用户和数据目录
adduser --system --shell /bin/bash --group gitea
mkdir -p /var/lib/gitea/{data,repositories,log}
chown -R gitea:gitea /var/lib/gitea
# 配置 systemd service，监听 localhost:3001
# 首次启动后通过 Web UI 完成初始化，创建管理员账号

# 2. 安装 Nginx
apt install nginx
# 配置 /etc/nginx/sites-available/esl（路由规则见上文）
ln -s /etc/nginx/sites-available/esl /etc/nginx/sites-enabled/
systemctl restart nginx

# 3. 安装 API Server
cd /opt/esl-server
git clone <esl-repo> .
npm install --production
cp .env.example .env
# 编辑 .env：
#   DATABASE_PATH=/opt/esl-server/data/esl.db
#   GITEA_URL=http://localhost:3001
#   GITEA_ADMIN_TOKEN=<管理员token>

# 4. 启动 API Server（PM2 管理）
npm install -g pm2
pm2 start npm --name "esl-api" -- start
pm2 save
pm2 startup
```

#### Linux 目录结构

```
/var/lib/gitea/                    # Gitea 数据目录
├── data/                          # Gitea 内部数据
├── repositories/                  # Git 仓库存储
│   ├── zhangsan/
│   │   └── my-helper.git
│   └── frontend-team/
│       └── code-review.git
└── gitea.db                       # Gitea 自己的 SQLite

/opt/esl-server/                   # API Server
├── packages/server/
└── data/
    └── esl.db                     # 技能元数据索引（不含用户/权限）

/etc/nginx/                        # Nginx
└── sites-available/esl            # ESL 路由配置
```

### 8.3 手动部署 — Windows 服务器

#### 前置要求

- Windows Server 2019+ 或 Windows 10+
- Node.js 18+
- Git for Windows

#### 安装步骤

```powershell
# 1. 安装 Gitea
#    下载 gitea.exe
#    https://dl.gitea.com/gitea/latest/gitea-latest-windows-amd64.exe
mkdir C:\gitea
# 将 gitea.exe 放入 C:\gitea\
# 注册为 Windows 服务：
sc create gitea start= auto binPath= "C:\gitea\gitea.exe web --config C:\gitea\custom\conf\app.ini"
# 首次启动后通过 Web UI 完成初始化，创建管理员账号

# 2. 安装 Nginx
#    下载 Nginx Windows 版
#    https://nginx.org/en/download.html
#    解压到 C:\nginx\
#    编辑 C:\nginx\conf\nginx.conf（路由规则同 Linux 版）
#    注册为服务（可用 nssm 工具）或前台运行

# 3. 安装 API Server
cd C:\esl-server
npm install --production
# 编辑 .env 配置文件

# 4. 启动 API Server
npm install -g pm2
pm2 start npm --name "esl-api" -- start
pm2 save
```

#### Windows 目录结构

```
C:\gitea\                          # Gitea 安装目录
├── gitea.exe
├── custom\conf\app.ini            # Gitea 配置
├── data\                          # Gitea 内部数据
├── repositories\                  # Git 仓库存储
│   ├── zhangsan\
│   │   └── my-helper.git
│   └── frontend-team\
│       └── code-review.git
└── gitea.db                       # Gitea SQLite

C:\esl-server\                     # API Server
├── packages\server\
└── data\
    └── esl.db                     # 技能元数据索引

C:\nginx\                          # Nginx
├── nginx.exe
└── conf\nginx.conf
```

### 8.4 跨平台部署总结

| 部署方式 | Linux | Windows | 备注 |
|----------|-------|---------|------|
| **Docker Compose** | ✅ | ✅ (Docker Desktop) | 推荐，环境一致 |
| **手动部署** | ✅ Nginx + systemd + PM2 | ✅ Nginx + Windows Service + PM2 | 三个组件都跨平台 |
| **Gitea** | 原生二进制 / systemd | 原生 .exe / Windows Service | 无差异 |
| **API Server** | Node.js + PM2 | Node.js + PM2 | 无差异 |
| **Nginx** | 原生 apt/yum 安装 | 官方 Windows 版 | Windows 版功能完整，企业内网场景足够 |

### 8.5 后续演进：HTTPS

在 Nginx 层添加 SSL 证书即可，对内部架构无影响：

```nginx
server {
    listen 443 ssl;
    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    # ... 其余路由规则不变
}
```

CLI 配置中的 URL 从 `http://` 改为 `https://` 即可。

---

## 9. 对现有代码的影响

### 9.1 不受影响的部分（已实现）

| 模块 | 位置 | 说明 |
|------|------|------|
| 技能格式校验 | `packages/core/validate/` | 校验 `skill.json` 格式，与 Git 托管无关 |
| 版本管理 | `packages/cli/version` | 修改 `skill.json` 版本号，与 Git 托管无关 |
| 技能目录结构 | `skill.json` 格式定义 | 不变 |
| 本地存储目录结构 | `~/.skill-library/skills/` | 不变 |

### 9.2 需要调整的部分

| 模块 | 变化 |
|------|------|
| 本地配置文件格式 | 去掉 SSH 相关字段，新增 `token`、`gitBase`、`username` |
| `esl login` | 从 SSH Key 注册改为用户名密码换 Gitea token |

### 9.3 新增的部分（后续 Phase 实现）

| 模块 | 说明 |
|------|------|
| `esl publish` | 调 API Server + Git HTTP push |
| `esl install` | 调 API Server + Git HTTP clone |
| `esl search` | 调 API Server |
| API Server | Fastify 服务端，包含 `GiteaService` |
| Nginx 配置 | 路由模板 |
| Docker Compose | 编排文件 |

---

## 10. 原设计文档受影响章节

本文档是对 [ESL 设计规格文档 v1.0.0](./2026-07-27-enterprise-skill-library-design.md) 的增量修订。以下章节需要根据本文档更新：

| 原文档章节 | 修改内容 |
|-----------|---------|
| §1.4 技术栈 | Gitolite → Gitea，新增 Nginx |
| §2 系统总体架构 | 架构图、组件职责、数据流向全部更新 |
| §4 权限与用户系统 | 去掉 Gitolite 映射，改为 Gitea 映射（本文档 §4） |
| §5.2 CLI 命令 `esl login` | 登录流程变化（本文档 §3） |
| §6 本地存储结构 | 配置文件格式变化（本文档 §3.4） |
| §7 服务端 API 设计 | 认证方式从 JWT+SSH → Gitea token 代理验证（本文档 §3.3） |
| §8 数据模型 | 去掉 users/permissions 表（本文档 §6） |
| §9 Gitolite 集成 | **整章替换**为"Gitea 集成"（本文档 §7） |
| §10 部署架构 | V1 加 Nginx，Docker Compose 换 Gitea，补充 Windows 部署（本文档 §8） |
| §12 核心工作流 | 发布/安装流程中的 SSH → HTTP（本文档 §5） |
