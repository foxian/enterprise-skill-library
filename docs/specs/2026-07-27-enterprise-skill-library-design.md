# Enterprise Skill Library (ESL) — 设计规格文档

> **版本**: 1.0.0-draft
> **日期**: 2026-07-27
> **状态**: 待审阅

---

## 目录

1. [概述](#1-概述)
2. [系统总体架构](#2-系统总体架构)
3. [技能格式与仓库结构](#3-技能格式与仓库结构)
4. [权限与用户系统](#4-权限与用户系统)
5. [客户端 CLI 设计](#5-客户端-cli-设计)
6. [本地存储结构](#6-本地存储结构)
7. [服务端 API 设计](#7-服务端-api-设计)
8. [数据模型](#8-数据模型)
9. [Gitolite 集成](#9-gitolite-集成)
10. [部署架构](#10-部署架构)
11. [多工具适配引擎](#11-多工具适配引擎)
12. [核心工作流](#12-核心工作流)
13. [错误处理与边界情况](#13-错误处理与边界情况)
14. [测试策略](#14-测试策略)
15. [分阶段实现计划](#15-分阶段实现计划)

---

## 1. 概述

### 1.1 项目定位

Enterprise Skill Library（ESL）是一个企业级 AI Agent 技能库管理系统。它为企业内部的开发者提供一个统一的平台，用于创建、发布、共享和管理 AI Agent 技能（Skills）。

### 1.2 核心理念

- **Git 为核心**：每个技能是一个独立 Git 仓库，所有版本和历史由 Git 管理
- **类 npm 体验**：CLI 命令设计、版本管理、全局/项目级安装均对齐 npm 使用习惯
- **统一格式，动态适配**：技能以 Agent Skills 开放标准格式存储，安装时动态转换到目标 AI 工具
- **渐进式权限**：V1 实现简单的公开/私有模型，后续迭代支持团队级精细权限

### 1.3 目标用户

- 企业内部的 AI 开发者和工程师
- 使用 Claude Code、Trae、Trae-work、Codex 等 AI 编程工具的团队

### 1.4 技术栈

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| CLI 客户端 | Node.js + Commander/Yargs | 与 npm 生态统一，开发者普遍有 Node 环境 |
| API 服务端 | Node.js + Fastify | 与客户端统一技术栈，降低维护成本 |
| 数据库 | SQLite | V1 轻量快速，后续按需升级 |
| Git 托管 | Gitolite 3 | 成熟的 Git 仓库权限管理，V1 用 SSH，后续支持 HTTP |
| 反向代理 | Nginx（后续版本） | V1 不用，后续引入作为统一入口 |
| 测试框架 | Vitest | 与 Node.js 生态统一 |

---

## 2. 系统总体架构

### 2.1 架构图

```
┌────────────────────────────────────────────────┐
│                    服务器                          │
│                                                   │
│  ┌──────────────┐  ┌───────────────┐             │
│  │ Fastify API   │  │ Gitolite       │             │
│  │ :3000         │  │ SSH :22        │             │
│  └──────┬───────┘  └───────┬───────┘             │
│         │                  │                      │
│         │          ┌───────┴───────┐              │
│         │          │ Git 仓库       │              │
│  ┌──────┴───────┐  │ (统一存储)     │              │
│  │ SQLite DB    │  └───────────────┘              │
│  └──────────────┘                                 │
└────────────────────────────────────────────────┘
         ▲                    ▲
         │ HTTP :3000         │ SSH :22
         │ (API 请求)         │ (Git 操作)
         │                    │
  ┌──────┴────────────────┴──────┐
  │  CLI Client (esl)                 │
  │  Local Store: ~/.skill-library/   │
  └───────────────────────────────────┘
```

### 2.2 组件职责

| 组件 | 职责 |
|------|------|
| **Nginx**（后续版本） | 反向代理，V1 不使用，后续引入作为统一入口 |
| **CLI Client (`esl`)** | 本地技能管理：初始化、校验、安装、发布、搜索、适配等操作 |
| **API Server** | 技能市场后端：元数据注册与索引、搜索、用户管理、权限校验，V1 直接对外暴露 |
| **Gitolite** | Git 仓库托管，V1 仅用 SSH，后续支持 HTTP 双协议 |
| **SQLite** | 存储技能元数据、用户信息、版本记录，提供搜索索引 |
| **Local Store** | 用户本地的全局和项目级技能缓存与管理 |

### 2.3 数据流向

1. **发布**：CLI → API Server（注册元数据 + 创建 Gitolite 仓库）→ CLI 通过 SSH 执行 `git push` 到 Gitolite
2. **安装**：CLI → API Server（查询元数据 + 权限校验）→ CLI 通过 SSH 执行 `git clone` 从 Gitolite → 本地适配
3. **搜索**：CLI → API Server（查询 SQLite 数据库）→ 返回结果
4. **V1 传输协议**：API 走 HTTP，Git 走 SSH；后续引入 Nginx 统一为 HTTPS

---

## 3. 技能格式与仓库结构

### 3.1 技能仓库结构

每个技能是一个独立 Git 仓库。仓库同时承担两个职责：

1. **ESL 包**：包含 `skill.json`、版本、作者、依赖、发布信息等企业技能库元数据。
2. **Agent 运行时技能**：遵循 Agent Skills / Codex Skills 的渐进式加载原则，只把 Agent 执行技能所需的文件暴露给目标工具。

```
my-awesome-skill/
├── skill.json                    # 管理元数据（版本、作者、依赖、兼容性等）
├── SKILL.md                      # 技能入口（YAML frontmatter + Markdown 指令）
├── README.md                     # 可选：人类可读文档，不进入 Agent 触发依据
├── CHANGELOG.md                  # 可选：版本变更记录，不进入 Agent 触发依据
├── agents/                       # 可选：目标工具 UI 元数据
│   └── openai.yaml
├── scripts/                      # 辅助脚本（Python、Bash 等）
│   └── validate.py
├── references/                   # 参考文档（Agent 按需加载）
│   └── api-guide.md
├── assets/                       # 模板、图片、示例工程等输出资源
│   └── config-template.yaml
└── evals/                        # 可选：技能测试用例
    └── evals.json
```

> **运行时裁剪原则**：安装或适配到具体 Agent 工具时，CLI 只暴露 `SKILL.md`、`agents/`（若目标工具支持）、`scripts/`、`references/`、`assets/` 等运行时文件。`skill.json`、`README.md`、`CHANGELOG.md` 属于 ESL 包管理层，不应参与 Agent 的技能触发判断。

### 3.2 `skill.json` 规范

`skill.json` 是技能的管理元数据文件，类似于 npm 的 `package.json`：

```json
{
  "name": "@myorg/debugging-helper",
  "version": "1.2.0",
  "description": "系统化调试技能，帮助 Agent 通过假设驱动的方式定位和修复 Bug",
  "author": "zhangsan",
  "license": "MIT",
  "keywords": ["debugging", "testing", "systematic"],
  "compatibility": {
    "tools": ["claude-code", "trae", "trae-work", "codex"],
    "languages": ["python", "javascript", "typescript"]
  },
  "dependencies": {
    "@myorg/test-utils": "^1.0.0"
  },
  "repository": "git@skills.company.com:myorg/debugging-helper.git"
}
```

#### 字段说明

| 字段 | 必需 | 类型 | 说明 |
|------|:----:|------|------|
| `name` | ✅ | string | 技能全名，格式 `@scope/skill-name` |
| `version` | ✅ | string | 语义化版本号（SemVer） |
| `description` | ✅ | string | 技能描述 |
| `author` | ✅ | string | 作者用户名 |
| `license` | ❌ | string | 许可证 |
| `keywords` | ❌ | string[] | 搜索关键词 |
| `compatibility.tools` | ❌ | string[] | 兼容的 AI 工具列表 |
| `compatibility.languages` | ❌ | string[] | 适用的编程语言 |
| `dependencies` | ❌ | object | 依赖的其他技能及版本约束 |
| `repository` | ❌ | string | Git 仓库地址（发布后自动填充） |

### 3.3 `SKILL.md` 规范

遵循 Agent Skills / Codex Skills 的核心结构。`SKILL.md` 是 Agent 的运行时入口，应保持精简，并通过 `references/`、`scripts/`、`assets/` 实现渐进式加载：

```markdown
---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior in software projects.
---

# 系统化调试

## 核心原则
先收集可验证的事实，再形成假设，最后用最小实验验证或排除假设。

## 步骤

### 1. 收集信息
- 查看错误日志和堆栈追踪
- 确认复现步骤
...

### 2. 形成假设
- 基于收集的信息形成 2-3 个可能的原因假设
...
```

#### YAML Frontmatter 字段

| 字段 | 必需 | 说明 |
|------|:----:|------|
| `name` | ✅ | 技能名（与目录名匹配，1-64 字符，小写 + 连字符） |
| `description` | ✅ | Agent 用来判断何时激活该技能的描述（最多 1024 字符）。应描述触发场景，而不是复述技能流程 |

`SKILL.md` frontmatter 不放 `author`、`version`、`license`、`compatibility` 等包管理字段。这些字段统一放入 `skill.json`，避免污染 Agent 的触发语义。

#### 运行时资源约定

| 目录 | 用途 |
|------|------|
| `scripts/` | 可执行辅助脚本，适合确定性、重复性高的操作 |
| `references/` | 大段参考文档、API 文档、领域知识，Agent 按需读取 |
| `assets/` | 模板、图片、字体、样例工程等输出资源 |
| `agents/` | 目标 Agent 工具的 UI 元数据，如 Codex 的 `openai.yaml` |
| `evals/` | 技能测试用例和评估数据，不属于运行时必需内容 |

### 3.4 命名约定

- **格式**：`@scope/skill-name`
- **scope**：组织或团队名，小写字母 + 连字符
- **skill-name**：技能名，小写字母 + 连字符
- **示例**：`@frontend-team/react-component-gen`、`@devops/k8s-debugger`

### 3.5 版本管理

- 使用 **语义化版本（SemVer）**：`MAJOR.MINOR.PATCH`
  - `PATCH`：修 bug、小改动（向后兼容）
  - `MINOR`：加新功能（向后兼容）
  - `MAJOR`：破坏性变更（不向后兼容）
- **版本号由作者控制**：通过 `esl version <major|minor|patch>` 命令或手动编辑 `skill.json`
- **Git Tag 由 CLI 自动打**：发布时自动执行 `git tag vX.Y.Z` 并推送
- **版本范围语法**（安装时使用）：

| 语法 | 含义 | 匹配范围 |
|------|------|---------|
| `1.2.0` | 精确版本 | 只匹配 1.2.0 |
| `^1.2.0` | 兼容版本 | ≥1.2.0 且 <2.0.0 |
| `~1.2.0` | 近似版本 | ≥1.2.0 且 <1.3.0 |
| `latest` | 最新版 | 服务端最新发布的版本 |

---

## 4. 权限与用户系统

### 4.1 最终目标模型（完整版）

```
可见性层级:
  ├── public    → 所有企业用户可见
  ├── team      → 仅指定团队/组的成员可见（V2）
  └── private   → 仅作者和显式授权用户可见

操作权限:
  ├── read      → 可以查看技能内容和元数据
  ├── use       → 可以安装和使用该技能（隐含 read）
  ├── write     → 可以修改和发布新版本（隐含 use）
  └── admin     → 可以管理权限、删除技能（隐含 write）
```

权限继承关系：`admin ⊃ write ⊃ use ⊃ read`

### 4.2 权限与 Gitolite 的映射

| 业务权限 | Gitolite 权限 | 说明 |
|----------|-------------|------|
| `read` | `R` | 可以 `git clone` |
| `use` | `R`（同 read） | API 层额外校验安装权限 |
| `write` | `RW+` | 可以 `git push` |
| `admin` | `RW+` + API 管理权限 | Gitolite 权限 + API 层管理操作 |

**设计要点**：Gitolite 只管 Git 层面的读写权限，业务层面的"使用权限"和"可见性"由 API Server 负责校验。

### 4.3 用户与团队

- **用户**：通过 SSH Key 注册到 Gitolite，通过 API 注册用户信息
- **团队**：利用 Gitolite 的 `@group` 机制映射到业务团队（V2）
- **技能拥有者**：上传者自动获得 `admin` 权限

### 4.4 V1 简化实现

第一个版本仅实现：

- **可见性**：`public`（所有人可见可用） 和 `private`（仅作者可见可用）
- **权限**：上传者拥有 `admin`，其他用户对公开技能拥有 `read` + `use`
- **不实现**：团队概念、团队可见性、精细权限授权（V2 迭代）

---

## 5. 客户端 CLI 设计

### 5.1 CLI 工具名称

`esl`（Enterprise Skill Library 的缩写）

### 5.2 命令一览

#### 技能开发

```bash
esl init <skill-name>              # 初始化技能项目，生成标准目录结构和模板文件
esl validate                       # 校验当前技能目录是否符合标准格式
esl version <major|minor|patch>    # 递增版本号（修改 skill.json）
```

#### 技能发布与获取

```bash
esl publish                        # 发布技能到服务端
                                   # 流程：校验格式 → 注册元数据(API)
                                   #       → 创建仓库(Gitolite) → 打 Tag → git push
esl unpublish <skill-name>         # 从市场撤下技能

esl install <name>[@version]       # 安装技能到当前项目 (.skills/)
esl install -g <name>[@version]    # 安装技能到全局 (~/.skill-library/)
esl uninstall <name>               # 卸载技能

esl update [name]                  # 在版本约束范围内更新到最新兼容版本
esl install <name>@latest          # 强制安装最新版本（更新版本约束）
esl outdated                       # 检查哪些已安装技能有新版本可用
```

#### 技能市场

```bash
esl search <keyword>               # 按关键词搜索技能
esl info <skill-name>              # 查看技能详细信息（描述、版本、作者等）
esl list                           # 列出本地已安装的技能
esl list --remote                  # 列出服务端可用的技能
```

#### 多工具适配

```bash
esl adapt <tool>                   # 将已安装技能适配到指定工具的目录格式
                                   # 支持: claude-code, trae, trae-work, codex
esl adapt --all                    # 适配到 .skills.json 中配置的所有工具
```

#### 配置

```bash
esl config set registry <url>      # 设置 API Server 地址
esl config set tools <tool,...>    # 设置默认适配工具列表
esl login                          # 登录：配置 SSH Key + 获取 API Token
esl whoami                         # 显示当前登录用户
```

### 5.3 命令行为详述

#### `esl init <skill-name>`

```
输入: esl init @myorg/my-debug-skill
输出:
  创建目录 my-debug-skill/
  ├── skill.json        (预填 name、version: "0.1.0"、author)
  ├── SKILL.md          (模板，含 YAML frontmatter 示例)
  ├── scripts/          (空目录)
  ├── references/       (空目录)
  └── assets/           (空目录)
  执行 git init
  提示: "技能 my-debug-skill 已初始化，请编辑 SKILL.md 添加技能指令。"
```

`README.md`、`CHANGELOG.md`、`agents/openai.yaml`、`evals/` 属于可选增强内容，后续可通过独立命令或手动添加。Phase 1 的 `init` 默认生成最小可运行技能包，避免鼓励臃肿技能结构。

#### `esl publish`

```
前置条件: 当前目录是一个有效的技能目录（含 skill.json + SKILL.md）
流程:
  1. 运行 esl validate 校验格式
  2. 读取 skill.json 中的 name 和 version
  3. POST /api/skills 注册技能元数据（首次发布时创建 Gitolite 仓库）
  4. git tag vX.Y.Z
  5. git push origin main --tags
  6. POST /api/skills/:name/versions 注册版本
  7. 输出: "✅ @scope/skill-name@1.2.0 发布成功"
```

#### `esl install <name>[@version]`

```
流程:
  1. GET /api/skills/:name 查询技能信息和仓库地址
  2. API 校验当前用户是否有 use 权限
  3. git clone 到 ~/.skill-library/cache/@scope/name/
  4. git checkout 到匹配版本约束的最佳版本 Tag
  5. 复制技能文件到 .skills/@scope/name/（项目级）或 ~/.skill-library/skills/（全局）
  6. 更新 .skills.json 的 dependencies
  7. 更新 .skills-lock.json 的精确版本
  8. 如果 .skills.json 中配置了 tools，自动执行 esl adapt --all
  9. 输出: "✅ @scope/name@1.3.0 已安装"
```

#### `esl update [name]`

```
流程:
  1. 读取 .skills.json 中的版本约束（如 "^1.2.0"）
  2. GET /api/skills/:name/versions 查询可用版本
  3. 在约束范围内找到最高版本（如 ^1.2.0 → 1.3.0，跳过 2.0.0）
  4. 如果有新版本:
     - cd cache 目录，git fetch && git checkout vX.Y.Z
     - 更新 .skills/ 目录
     - 更新 .skills-lock.json
     - 重新执行适配
  5. 输出: "✅ @scope/name: 1.2.0 → 1.3.0"
```

#### `esl install <name>@latest`

```
行为: 忽略现有版本约束，安装最新版本
额外操作: 同时更新 .skills.json 中的版本约束
示例:
  .skills.json 原来: "@org/skill": "^1.2.0"
  服务端最新: 2.0.0
  安装后: "@org/skill": "^2.0.0"
```

---

## 6. 本地存储结构

### 6.1 全局存储

```
~/.skill-library/                        # 全局根目录
├── config.json                          # 全局配置
│   {
│     "registry": "https://skills.company.com/api",
│     "tools": ["claude-code", "trae"],
│     "user": "zhangsan"
│   }
│
├── credentials.json                     # 认证信息（文件权限 600）
│   {
│     "api_token": "esl_xxxxxxxxxxxxxxxx",
│     "ssh_key_path": "~/.ssh/id_ed25519"
│   }
│
├── cache/                               # Git 仓库缓存（原始 clone）
│   └── @org/
│       └── skill-name/
│           └── <bare-git-repo>
│
└── skills/                              # 已安装的全局技能
    └── @org/
        └── skill-name/
            ├── skill.json
            ├── SKILL.md
            └── ...
```

### 6.2 项目级存储

```
project-root/
├── .skills.json                         # 技能依赖清单
│   {
│     "tools": ["claude-code", "trae"],
│     "dependencies": {
│       "@org/debugging-helper": "^1.2.0",
│       "@org/code-review": "^2.0.0"
│     }
│   }
│
├── .skills-lock.json                    # 锁文件（精确版本，提交到 Git）
│   {
│     "lockfileVersion": 1,
│     "dependencies": {
│       "@org/debugging-helper": {
│         "version": "1.3.0",
│         "resolved": "git@skills.company.com:org/debugging-helper.git",
│         "integrity": "sha256-xxxx"
│       },
│       "@org/code-review": {
│         "version": "2.0.1",
│         "resolved": "git@skills.company.com:org/code-review.git",
│         "integrity": "sha256-yyyy"
│       }
│     }
│   }
│
├── .skills/                             # 技能源文件（原始格式）
│   └── @org/
│       └── debugging-helper/
│           ├── skill.json
│           ├── SKILL.md
│           ├── scripts/
│           └── ...
│
│  ──── 以下由 esl adapt 自动生成（symlink 或复制）────
│
├── .claude/skills/                      # Claude Code 适配映射
│   └── debugging-helper/ → ../../.skills/@org/debugging-helper/
│
├── .trae/skills/                        # Trae / Trae-work 适配映射
│   └── debugging-helper/ → ../../.skills/@org/debugging-helper/
│
└── AGENTS.md                            # Codex 适配（合并生成）
```

### 6.3 `.gitignore` 建议

```gitignore
# ESL 本地技能缓存（不提交，每个开发者独立安装）
.skills/

# 各工具适配输出（由 esl adapt 自动生成）
.claude/skills/
.trae/skills/

# 以下文件应该提交到项目 Git
# .skills.json          ← 技能依赖声明
# .skills-lock.json     ← 锁定版本
```

---

## 7. 服务端 API 设计

### 7.1 服务架构

```
┌──────────────────────────────────────────────┐
│             API Server (Fastify)              │
├────────────┬────────────┬────────────────────┤
│   Auth     │   Skills   │   Users / Teams    │
│   Module   │   Module   │   Module           │
├────────────┴────────────┴────────────────────┤
│          Gitolite Admin Interface             │
│    (操作 gitolite-admin 仓库管理权限)          │
├──────────────────────────────────────────────┤
│              SQLite Database                  │
└──────────────────────────────────────────────┘
```

### 7.2 认证机制

- **API 认证**：Bearer Token（`Authorization: Bearer esl_xxxx`）
- **Git 认证**：SSH Key（通过 Gitolite 管理）
- **Token 生成**：用户登录时由 API Server 签发
- **Token 存储**：客户端保存在 `~/.skill-library/credentials.json`（权限 600）

### 7.3 API 端点详述

#### 认证

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/auth/register` | 注册新用户 | `{ username, email, ssh_public_key }` | `{ user, api_token }` |
| POST | `/api/auth/login` | 登录获取 Token | `{ username, ssh_public_key }` | `{ api_token }` |
| GET | `/api/auth/whoami` | 当前用户信息 | — | `{ user }` |

#### 技能管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/skills` | 注册新技能 | 已登录用户 |
| GET | `/api/skills` | 搜索/列出技能 | 公开技能无需认证 |
| GET | `/api/skills/:name` | 获取技能详情 | 需要 read 权限 |
| PUT | `/api/skills/:name` | 更新技能元数据 | 需要 write 权限 |
| DELETE | `/api/skills/:name` | 删除技能 | 需要 admin 权限 |
| PATCH | `/api/skills/:name/visibility` | 修改可见性 | 需要 admin 权限 |

##### `POST /api/skills` 详述

```
请求体:
{
  "name": "@myorg/debugging-helper",
  "description": "系统化调试技能",
  "visibility": "public",
  "keywords": ["debugging", "testing"],
  "compatibility": {
    "tools": ["claude-code", "trae"],
    "languages": ["javascript", "python"]
  }
}

服务端流程:
  1. 验证用户身份
  2. 检查技能名是否已存在
  3. 在 Gitolite 中创建仓库
  4. 设置仓库权限（创建者 = RW+）
  5. 写入数据库
  6. 返回技能信息 + Git 仓库地址

响应:
{
  "skill": {
    "id": "uuid",
    "name": "@myorg/debugging-helper",
    "git_url": "git@skills.company.com:myorg/debugging-helper.git",
    ...
  }
}
```

##### `GET /api/skills` 详述

```
查询参数:
  ?q=debugging          # 关键词搜索
  &tools=claude-code    # 按兼容工具筛选
  &page=1               # 分页
  &limit=20             # 每页数量
  &sort=downloads       # 排序: downloads | updated | name

响应:
{
  "skills": [...],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

#### 版本管理

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/skills/:name/versions` | 注册新版本 | 需要 write 权限 |
| GET | `/api/skills/:name/versions` | 列出所有版本 | 需要 read 权限 |

##### `POST /api/skills/:name/versions` 详述

```
请求体:
{
  "version": "1.2.0",
  "git_tag": "v1.2.0",
  "changelog": "修复了边界条件下的误判问题",
  "skill_json": { ... }    // 该版本的 skill.json 快照
}

服务端流程:
  1. 验证版本号是否符合 SemVer
  2. 检查该版本是否已存在
  3. 写入 SkillVersions 表
  4. 更新 Skills 表的 latest_version
  5. 返回版本信息
```

#### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/users/:username` | 查看用户公开信息 |
| GET | `/api/users/:username/skills` | 查看用户发布的技能列表 |

---

## 8. 数据模型

### 8.1 V1 数据表

#### Users 表

```sql
CREATE TABLE users (
    id              TEXT PRIMARY KEY,      -- UUID
    username        TEXT UNIQUE NOT NULL,
    email           TEXT UNIQUE NOT NULL,
    ssh_public_key  TEXT NOT NULL,
    api_token_hash  TEXT,                  -- bcrypt 哈希
    created_at      TEXT NOT NULL,         -- ISO 8601
    updated_at      TEXT NOT NULL
);
```

#### Skills 表

```sql
CREATE TABLE skills (
    id              TEXT PRIMARY KEY,      -- UUID
    name            TEXT UNIQUE NOT NULL,  -- @scope/skill-name
    description     TEXT,
    latest_version  TEXT,                  -- 最新版本号
    visibility      TEXT DEFAULT 'public', -- public | private
    owner_id        TEXT NOT NULL,         -- FK → users.id
    keywords        TEXT,                  -- JSON array
    compatibility   TEXT,                  -- JSON object
    download_count  INTEGER DEFAULT 0,
    git_repo_path   TEXT NOT NULL,         -- Gitolite 仓库路径
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);
```

#### SkillVersions 表

```sql
CREATE TABLE skill_versions (
    id                  TEXT PRIMARY KEY,  -- UUID
    skill_id            TEXT NOT NULL,     -- FK → skills.id
    version             TEXT NOT NULL,     -- "1.2.0"
    git_tag             TEXT NOT NULL,     -- "v1.2.0"
    changelog           TEXT,
    published_at        TEXT NOT NULL,
    skill_json_snapshot TEXT,              -- JSON，该版本 skill.json 快照
    FOREIGN KEY (skill_id) REFERENCES skills(id),
    UNIQUE (skill_id, version)
);
```

### 8.2 V2 新增数据表

#### Teams 表

```sql
CREATE TABLE teams (
    id          TEXT PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL
);
```

#### TeamMembers 表

```sql
CREATE TABLE team_members (
    team_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'member',  -- admin | member
    joined_at   TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### SkillPermissions 表

```sql
CREATE TABLE skill_permissions (
    skill_id      TEXT NOT NULL,
    grantee_type  TEXT NOT NULL,          -- user | team
    grantee_id    TEXT NOT NULL,
    permission    TEXT NOT NULL,          -- read | use | write | admin
    granted_at    TEXT NOT NULL,
    PRIMARY KEY (skill_id, grantee_type, grantee_id),
    FOREIGN KEY (skill_id) REFERENCES skills(id)
);
```

---

## 9. Gitolite 集成

### 9.1 集成方式

API Server 通过操作 `gitolite-admin` 仓库来管理 Git 权限。服务端维护一个 `gitolite-admin` 仓库的本地克隆，通过修改配置文件并 `git push` 来使权限变更生效。

### 9.2 仓库命名约定

```
Gitolite 仓库路径: <scope>/<skill-name>
示例: myorg/debugging-helper
```

### 9.3 关键操作

#### 创建新技能仓库

```bash
# 修改 conf/gitolite.conf，添加：
repo myorg/debugging-helper
    RW+     =   zhangsan            # 创建者拥有完全权限
    R       =   @all                # 公开技能所有人可读（如果 visibility=public）

# 提交并推送
cd /path/to/gitolite-admin
git add conf/gitolite.conf
git commit -m "Add repo myorg/debugging-helper"
git push
```

#### 添加用户

```bash
# 将用户 SSH 公钥添加到 keydir/
cp user_key.pub keydir/zhangsan.pub
git add keydir/zhangsan.pub
git commit -m "Add user zhangsan"
git push
```

#### 修改权限（V2）

```bash
# 添加团队可见性
repo myorg/internal-tool
    RW+     =   zhangsan
    R       =   @frontend-team      # 团队成员可读

# Gitolite @group 定义
@frontend-team = lisi wangwu zhaoliu
```

### 9.4 Gitolite Admin Service

API Server 中的 Gitolite 管理服务负责：

1. **原子操作**：所有对 `gitolite-admin` 的修改通过锁机制保证原子性
2. **配置生成**：根据数据库中的权限数据生成 `gitolite.conf` 内容
3. **错误回滚**：如果 `git push` 失败，回滚本地修改
4. **状态同步**：确保数据库权限和 Gitolite 配置保持一致

---

## 10. 部署架构

### 10.1 V1 部署（简化版）

V1 采用最简部署方式，快速跑通整个流程：

- **API Server 直接对外暴露**（不经过 Nginx）
- **Git 使用 SSH 协议**（直接连接 Gitolite）
- 客户端需要知道两个地址：API 地址 + Git SSH 地址

```
┌──────────────────────────────────────────────────┐
│                    服务器                          │
│                                                   │
│  ┌──────────────┐  ┌───────────────┐             │
│  │ Fastify API   │  │ Gitolite      │             │
│  │ :3000         │  │ SSH :22       │             │
│  └──────┬───────┘  └───────┬───────┘             │
│         │                  │                      │
│         │          ┌───────┴───────┐              │
│         │          │ Git 仓库       │              │
│  ┌──────┴───────┐  │ (统一存储)     │              │
│  │ SQLite DB    │  └───────────────┘              │
│  └──────────────┘                                 │
└──────────────────────────────────────────────────┘
         ▲                    ▲
         │ HTTP :3000         │ SSH :22
         │ (API 请求)         │ (Git 操作)
         │                    │
  ┌──────┴────────────────────┴──────┐
  │  CLI Client (esl)                 │
  │                                   │
  │  API → http://server:3000/api/*   │
  │  Git → git@server:org/skill.git   │
  └───────────────────────────────────┘
```

#### V1 客户端配置

```bash
# 设置 API 服务地址
esl config set registry http://192.168.1.100:3000/api

# 登录（注册 SSH Key + 获取 API Token）
esl login

# Git 操作直接通过 SSH
# esl install 内部执行: git clone git@192.168.1.100:org/skill-name.git
```

### 10.2 Docker Compose 部署（推荐）

一键拉起所有服务，环境可复现：

```yaml
# docker-compose.yml
version: '3.8'

services:
  # ─── API Server ───
  api:
    build: ./packages/server
    ports:
      - "3000:3000"
    volumes:
      - db-data:/app/data                    # SQLite 数据文件
    environment:
      - DATABASE_PATH=/app/data/esl.db
      - GITOLITE_HOST=gitolite
      - GITOLITE_USER=git
      - GITOLITE_ADMIN_KEY=/app/keys/admin   # API Server 的 admin SSH Key
    depends_on:
      - gitolite

  # ─── Gitolite (Git 仓库 + SSH) ───
  gitolite:
    image: jgiannuzzi/gitolite       # 社区维护的 Gitolite 镜像
    ports:
      - "22:22"                       # SSH 端口
    volumes:
      - git-repos:/var/lib/gitolite/repositories   # Git 仓库持久化
      - gitolite-home:/var/lib/gitolite             # Gitolite 配置

volumes:
  db-data:          # SQLite 数据持久化
  git-repos:        # Git 仓库持久化
  gitolite-home:    # Gitolite 配置持久化
```

#### Docker Compose 架构

```
Docker Compose
┌─────────────────────────────────────────┐
│                                         │
│  ┌─────────────┐    ┌──────────────┐    │
│  │ api          │───►│ gitolite      │    │
│  │ :3000        │SSH │ :22           │    │
│  │ (Fastify)    │    │              │    │
│  └──────┬──────┘    └──────┬───────┘    │
│         │                  │            │
│    ┌────┴────┐     ┌───────┴──────┐     │
│    │ SQLite  │     │ Git Repos    │     │
│    │ volume  │     │ volume       │     │
│    └─────────┘     └──────────────┘     │
└─────────────────────────────────────────┘
    :3000 ↕              :22 ↕
    (API HTTP)           (Git SSH)
```

#### API Server 操作 Gitolite 的方式

API Server 通过 SSH 连接 Gitolite 容器，操作 `gitolite-admin` 仓库：

```
API Server 内部流程：
1. 容器启动时生成或加载一个专用 admin SSH Key
2. 该 Key 注册为 Gitolite 管理员
3. 需要创建仓库/修改权限时：
   a. git clone git@gitolite:gitolite-admin（缓存在本地）
   b. 修改 conf/gitolite.conf（添加仓库/权限规则）
   c. 或添加 keydir/username.pub（添加用户 SSH Key）
   d. git commit && git push
   e. Gitolite 自动应用新配置
```

#### 启动命令

```bash
# 首次启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down

# 停止并清除数据（慎用）
docker compose down -v
```

### 10.3 手动部署（Linux 服务器）

适合不使用 Docker 的环境，在一台 Linux 服务器上手动安装所有组件。

#### 前置要求

- Linux 服务器（Ubuntu 22.04+ / CentOS 8+ 推荐）
- Node.js 18+
- Git 2.x
- SSH Server（通常已自带）

#### 安装步骤概要

```bash
# 1. 安装 Gitolite
sudo adduser --system --shell /bin/bash --group git
sudo -u git -H git clone https://github.com/sitaramc/gitolite ~/gitolite-source
sudo -u git -H ~/gitolite-source/install -to ~/bin
sudo -u git -H ~/bin/gitolite setup -pk /path/to/admin.pub

# 2. 安装 API Server
cd /opt/esl-server
git clone <esl-repo> .
npm install --production
cp .env.example .env
# 编辑 .env 配置数据库路径、Gitolite 连接信息等

# 3. 启动 API Server（推荐用 PM2 管理进程）
npm install -g pm2
pm2 start npm --name "esl-api" -- start
pm2 save
pm2 startup
```

#### 目录结构

```
/home/git/                          # Gitolite 用户目录
├── .gitolite/                      # Gitolite 配置
├── repositories/                   # 所有 Git 仓库
│   ├── gitolite-admin.git
│   └── org/
│       └── skill-name.git
└── .ssh/authorized_keys            # Gitolite 管理的 SSH Key

/opt/esl-server/                    # API Server
├── packages/server/
├── data/
│   └── esl.db                      # SQLite 数据库
└── keys/
    └── admin                       # API Server 的 admin SSH Key
```

### 10.4 后续演进：Nginx + HTTPS + Git HTTP 模式

后续版本将引入 Nginx 反向代理，统一对外暴露单一域名和端口：

```
                  skills.company.com
                         │
                    ┌────┴────┐
                    │  Nginx   │
                    │  :443    │
                    └────┬────┘
                         │
            ┌────────────┼──────────────┐
            │            │              │
        /api/*       /git/*         :22 (SSH 备用)
            │            │              │
            ▼            ▼              ▼
      Fastify API   Gitolite HTTP   Gitolite SSH
```

演进要点：
- **Nginx 反向代理**：单一域名 + 443 端口对外，`/api/*` 转发到 Fastify，`/git/*` 转发到 Gitolite HTTP
- **Git 主推 HTTPS**：`git clone https://skills.company.com/git/org/skill.git`，SSH 降为备用
- **权限统一**：Gitolite HTTP 模式复用 SSH 的权限配置
- **防火墙友好**：只需开放 443 端口
- **CLI 协议切换**：`esl config set protocol https`（默认）/ `ssh`（备用）

> **注意**：Nginx 配置、HTTPS 证书、Git HTTP 认证集成等细节将在实施该阶段时详细设计。

---

## 11. 多工具适配引擎

### 11.1 设计原则

技能仓库以 ESL 包格式保存，核心运行时入口是标准 Agent Skills 格式（`SKILL.md`）。适配到各 AI 工具时，客户端 CLI 只暴露目标工具需要的运行时文件，并过滤 ESL 包管理文件。

### 11.2 适配器接口

```typescript
interface ToolAdapter {
  /** 适配器名称 */
  name: string;

  /** 返回目标工具期望的技能存放路径 */
  targetDir(projectRoot: string): string;

  /**
   * 将技能适配到目标工具的格式
   * @param skillPath - 技能源路径（.skills/@scope/name/）
   * @param targetPath - 目标路径
   */
  adapt(skillPath: string, targetPath: string): Promise<void>;

  /**
   * 清理适配输出
   */
  clean(skillName: string, targetPath: string): Promise<void>;
}
```

### 11.3 各工具适配策略

#### Claude Code 适配器

| 项目 | 说明 |
|------|------|
| 目标路径 | `.claude/skills/<skill-name>/` |
| 转换策略 | **零转换**——SKILL.md 格式原生兼容 Claude Code |
| 实现方式 | 创建 symlink 指向 `.skills/@scope/<skill-name>/` |
| Windows | 使用目录 junction 或文件复制替代 symlink |

#### Trae 适配器

| 项目 | 说明 |
|------|------|
| 目标路径 | `.trae/skills/<skill-name>/` |
| 转换策略 | 同 Claude Code，SKILL.md 格式兼容 |
| 实现方式 | 创建 symlink |

#### Trae-work 适配器

| 项目 | 说明 |
|------|------|
| 目标路径 | `.trae/skills/<skill-name>/` |
| 转换策略 | 同 Trae |
| 实现方式 | 创建 symlink |

#### Codex 适配器

| 项目 | 说明 |
|------|------|
| 目标路径 | 项目根目录 `AGENTS.md` |
| 转换策略 | **需要转换**——读取 SKILL.md 内容，转为 AGENTS.md 格式 |
| 实现方式 | 读取所有已安装技能的 SKILL.md，合并生成一个 AGENTS.md 文件 |
| 注意 | 需要标记自动生成的部分，避免覆盖用户手写内容 |

### 11.4 适配器扩展

新增适配器只需：
1. 实现 `ToolAdapter` 接口
2. 在适配器注册表中注册
3. 即可通过 `esl adapt <new-tool>` 使用

---

## 12. 核心工作流

### 12.1 创建并发布技能

```
开发者                      CLI (esl)                  API Server           Gitolite
  │                           │                           │                    │
  │── esl init my-skill ─────►│                           │                    │
  │                           │── 生成目录结构 ──►         │                    │
  │◄── 初始化完成 ───────────│                           │                    │
  │                           │                           │                    │
  │   (编写 SKILL.md...)      │                           │                    │
  │                           │                           │                    │
  │── esl validate ──────────►│                           │                    │
  │◄── 校验通过 ─────────────│                           │                    │
  │                           │                           │                    │
  │── esl version minor ────►│                           │                    │
  │                           │── 更新 skill.json ──►     │                    │
  │◄── v1.1.0 ───────────────│                           │                    │
  │                           │                           │                    │
  │── esl publish ───────────►│                           │                    │
  │                           │── POST /api/skills ──────►│                    │
  │                           │                           │── 创建仓库 ────────►│
  │                           │                           │── 设置权限 ────────►│
  │                           │◄── 仓库地址 ─────────────│                    │
  │                           │── git tag v1.1.0 ──►      │                    │
  │                           │── git push ───────────────────────────────────►│
  │                           │── POST /versions ────────►│                    │
  │◄── 发布成功 ─────────────│                           │                    │
```

### 12.2 搜索并安装技能

```
用户                        CLI (esl)                  API Server           Gitolite
  │                           │                           │                    │
  │── esl search "debug" ───►│                           │                    │
  │                           │── GET /api/skills?q= ───►│                    │
  │                           │◄── 搜索结果 ─────────────│                    │
  │◄── 显示结果列表 ─────────│                           │                    │
  │                           │                           │                    │
  │── esl install @org/dbg ─►│                           │                    │
  │                           │── GET /skills/:name ─────►│                    │
  │                           │◄── 技能详情 + 仓库地址 ──│                    │
  │                           │── git clone ──────────────────────────────────►│
  │                           │── git checkout v1.3.0 ──► │                    │
  │                           │── 写入 .skills/ ──►       │                    │
  │                           │── 更新 .skills.json ──►   │                    │
  │                           │── 更新 .skills-lock ──►   │                    │
  │                           │── esl adapt --all ──►     │                    │
  │◄── 安装完成 ─────────────│                           │                    │
```

### 12.3 更新技能

```
用户                        CLI (esl)                  API Server           Gitolite
  │                           │                           │                    │
  │── esl update ────────────►│                           │                    │
  │                           │── 读取 .skills.json ──►   │                    │
  │                           │── GET /versions ─────────►│                    │
  │                           │◄── 可用版本列表 ─────────│                    │
  │                           │── 计算最佳匹配版本 ──►    │                    │
  │                           │── git fetch ──────────────────────────────────►│
  │                           │── git checkout vX.Y.Z ──► │                    │
  │                           │── 更新 .skills/ ──►       │                    │
  │                           │── 更新 .skills-lock ──►   │                    │
  │                           │── esl adapt --all ──►     │                    │
  │◄── 更新完成 ─────────────│                           │                    │
```

---

## 13. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| **网络断开** | CLI 离线时可继续使用已安装的本地技能；publish/install 操作提示网络错误 |
| **权限拒绝** | 清晰提示用户需要什么权限，以及如何获取权限 |
| **版本冲突** | 提示用户冲突的版本约束，建议解决方案 |
| **格式校验失败** | `esl validate` 逐项报告缺失字段和不符合规范之处 |
| **技能名重复** | 注册时 API 返回 409 冲突，提示换一个名称 |
| **Git push 失败** | 重试机制 + 详细错误提示（权限不足 / 网络超时 / 冲突等） |
| **锁文件冲突** | 提示用户运行 `esl install` 重新解析依赖 |
| **SSH Key 未配置** | `esl login` 时检测并引导用户生成或配置 SSH Key |
| **技能依赖缺失** | 安装时递归解析依赖，缺失的自动安装 |
| **磁盘空间不足** | 检测可用空间，提前警告 |

---

## 14. 测试策略

### 14.1 测试层级

| 层级 | 范围 | 框架 |
|------|------|------|
| **单元测试** | 各模块独立测试 | Vitest |
| **集成测试** | 端到端流程（init → publish → install → adapt） | Vitest + testcontainers |
| **E2E 测试** | 完整客户端-服务器交互 | Vitest + 真实 Gitolite 实例 |

### 14.2 测试重点

- **CLI 命令解析**：各命令的参数解析和校验
- **skill.json / SKILL.md 校验**：格式校验逻辑
- **版本范围解析**：SemVer 范围匹配逻辑
- **适配器**：各工具适配器的转换逻辑
- **API 端点**：请求/响应格式、权限校验、错误处理
- **Gitolite 集成**：仓库创建、权限配置、配置文件生成
- **数据库操作**：CRUD 操作、搜索查询

---

## 15. 分阶段实现计划

### Phase 1：基础框架 + 本地功能

**目标**：搭建项目脚手架，实现纯本地的技能开发功能。

| 任务 | 说明 |
|------|------|
| 项目初始化 | monorepo 结构（`packages/core` + `packages/cli`）、TypeScript 配置、Vitest |
| `skill.json` 规范 | ESL 包元数据 schema 定义 + 校验库 |
| `SKILL.md` 规范 | frontmatter 校验、运行时资源目录约定、渐进式加载约束 |
| 本地存储 | 全局配置目录结构（`~/.skill-library/`） |
| `esl init` | 初始化最小可运行技能包：`skill.json`、`SKILL.md`、`scripts/`、`references/`、`assets/`，并执行 `git init` |
| `esl validate` | 校验 `skill.json`、`SKILL.md`、运行时目录结构，并提示旧 `resources/` 迁移到 `assets/` |
| `esl version` | 递增 `skill.json` 版本号，不打 Git tag（打 tag 属于 publish 阶段） |

### Phase 2：服务端搭建

**目标**：搭建 API Server，实现用户注册登录和 Gitolite 集成。

| 任务 | 说明 |
|------|------|
| Fastify 服务 | 项目结构、中间件、错误处理 |
| SQLite 集成 | 数据库初始化、迁移脚本 |
| 用户模块 | 注册、登录、Token 管理 |
| Gitolite 集成 | gitolite-admin 操作封装、仓库创建、权限管理 |
| `esl login` / `esl whoami` | 客户端认证配置 |

### Phase 3：发布与获取

**目标**：实现核心的发布和安装流程。

| 任务 | 说明 |
|------|------|
| `esl publish` | 完整发布流程（校验→注册→推送→打 Tag） |
| `esl install` | 安装流程（查询→clone→checkout→存储） |
| `esl search` / `esl info` | 技能搜索和详情查询 |
| `esl list` | 本地和远程技能列表 |
| `esl update` / `esl outdated` | 版本更新机制 |
| `esl uninstall` / `esl unpublish` | 卸载和撤下 |
| `.skills.json` + `.skills-lock.json` | 依赖清单和锁文件管理 |

### Phase 4：多工具适配

**目标**：实现适配引擎和各工具的适配器。

| 任务 | 说明 |
|------|------|
| 适配引擎框架 | `ToolAdapter` 接口、适配器注册机制 |
| Claude Code 适配器 | symlink 映射到 `.claude/skills/` |
| Trae / Trae-work 适配器 | symlink 映射到 `.trae/skills/` |
| Codex 适配器 | SKILL.md → AGENTS.md 转换 |
| `esl adapt` 命令 | 单工具适配 + `--all` 批量适配 |
| 安装时自动适配 | `esl install` 完成后自动调用 adapt |

### Phase 5：权限增强

**目标**：实现团队概念和精细权限控制。

| 任务 | 说明 |
|------|------|
| Teams 数据模型 | 团队表、成员表 |
| 团队管理 API | 创建团队、添加/移除成员 |
| `team` 可见性 | 团队级可见性控制 |
| 精细权限 | read / use / write / admin 四级权限 |
| Gitolite `@group` | 团队到 Gitolite 组的映射 |

### Phase 6：体验优化

**目标**：提升整体用户体验，增加市场功能。

| 任务 | 说明 |
|------|------|
| Web UI | 技能市场浏览界面 |
| 技能评分/评论 | 用户反馈机制 |
| 下载统计 | 技能使用数据报表 |
| CI/CD 集成 | 自动化发布流水线 |
| 技能推荐 | 基于使用数据的智能推荐 |
