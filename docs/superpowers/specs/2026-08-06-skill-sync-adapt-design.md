# 技能同步与适配引擎设计

**日期**: 2026-08-06
**状态**: 待实施
**范围**: `install` 改造 + `adapt` / `update` / `clone` / `uninstall` 新增

---

## 1. 概述

### 1.1 问题陈述

ESL 当前支持技能的创建（`init`）、校验（`validate`）、发布（`publish`）和安装（`install`），但缺少以下关键能力：

1. **AI 工具同步**：安装的技能无法自动同步到 Claude Code、Codex、TRAE 等 AI 编程工具
2. **项目级依赖管理**：`install` 默认装到全局，无法按项目管理技能集
3. **版本更新**：无法批量或单独更新已安装技能
4. **协作开发**：无法方便地克隆技能源码参与贡献

### 1.2 设计原则

1. **全复制、零 symlink** — 所有安装和适配操作均为文件复制，避免 Windows symlink 兼容性问题
2. **项目 `.skills/` 是唯一真相** — 项目使用的技能和版本，由 `.skills/` + `.skills.json` 决定
3. **只读副本** — 复制到 AI 工具目录的文件设为只读，修改应回到源头
4. **npm 式心智模型** — 命令语义和工作流对标 npm，降低学习成本
5. **install 自动 adapt** — 安装完成后自动同步到 AI 工具，用户只需一个命令

### 1.3 技能生命周期

```
┌─ 开发阶段 ────────────────────────────────────────────┐
│  esl init → 创建技能 → 本地开发/测试                    │
│  esl install ../my-skill → 复制到项目 .skills/（临时）   │
│  install 自动触发 adapt → 同步到 AI 工具目录              │
├─ 发布 ────────────────────────────────────────────────┤
│  esl publish → 校验 + 注册 + git push → 服务器           │
├─ 正式使用 ────────────────────────────────────────────┤
│  esl install @scope/skill → 从服务器下载到 .skills/      │
│  install 自动触发 adapt → 同步到 AI 工具目录              │
│  esl update → 拉取最新版本                              │
├─ 协作开发 ────────────────────────────────────────────┤
│  esl clone @scope/skill → 克隆完整源码到工作目录          │
│  编辑 → 在项目中 esl install ../skill 测试              │
│  git push && esl publish → 发布新版本                    │
└───────────────────────────────────────────────────────┘

本地路径安装是临时的开发手段，发布后一律走服务器。
```

---

## 2. 命令设计

### 2.1 命令总览

| 命令 | 作用 | 状态 |
|---|---|---|
| `esl init` | 创建技能 | 已有，不变 |
| `esl validate` | 校验技能目录 | 已有，不变 |
| `esl version` | 升版本号 | 已有，不变 |
| `esl login` | 登录配置 | 已有，不变 |
| `esl search` | 搜索技能 | 已有，不变 |
| `esl info` | 查看技能详情 | 已有，不变 |
| `esl publish` | 发布技能 | 已有，不变 |
| `esl install` | 安装技能 | 改造 |
| `esl adapt` | 同步到 AI 工具目录 | 新增 |
| `esl update` | 更新已安装技能 | 新增 |
| `esl clone` | 克隆技能源码参与开发 | 新增 |
| `esl uninstall` | 卸载技能 | 新增 |

### 2.2 `esl install` 改造

#### 当前行为 vs 新行为

| 维度 | 当前 | 改造后 |
|---|---|---|
| 默认目标 | 全局 `~/.skill-library/skills/` | 项目 `.skills/` |
| 本地路径 | 不支持 | 支持 `esl install ../path` |
| 依赖记录 | 无 | 写入 `.skills.json` + `.skills-lock.json` |
| 自动 adapt | 无 | 默认触发 |

#### 命令形式

```bash
# 从服务器安装到项目
esl install @scope/my-skill             # 最新版本
esl install @scope/my-skill@1.2.0       # 指定版本
esl install                              # 根据 .skills.json 安装所有依赖

# 从本地路径安装到项目（复制）
esl install ../my-skill

# 安装到全局
esl install --global @scope/my-skill

# 跳过自动 adapt
esl install --no-adapt @scope/my-skill
```

#### 执行流程（从服务器，项目级）

```
esl install @scope/my-skill@1.2.0
  1. 调用 API GET /api/skills/@scope/my-skill → 获取 gitRepoPath
  2. git clone 到临时目录
  3. git checkout v1.2.0
  4. 复制技能文件到 .skills/@scope/my-skill/（排除 .git/）
  5. 设置目标文件为只读
  6. 写入 .skills.json: { "@scope/my-skill": "^1.2.0" }
  7. 写入 .skills-lock.json（version, resolved, integrity）
  8. 清理临时目录
  9. 自动执行 adapt（除非 --no-adapt）
```

#### 执行流程（从本地路径）

```
esl install ../my-skill
  1. 读取 ../my-skill/skill.json → 获取 name, version
  2. validateSkillDirectory(../my-skill) → 校验格式
  3. 复制技能文件到 .skills/@scope/my-skill/（排除 .git/）
  4. 设置目标文件为只读
  5. 写入 .skills.json: { "@scope/my-skill": "file:../my-skill" }
  6. 不写入 lock 文件（本地路径无固定版本快照）
  7. 自动执行 adapt（除非 --no-adapt）
```

#### 执行流程（裸 `esl install`，恢复依赖）

```
esl install
  1. 读取 .skills.json → 获取所有依赖
  2. 读取 .skills-lock.json → 获取锁定版本
  3. 对每个依赖：
     - 如果是 "^1.2.0" → 从服务器安装 lock 中的精确版本
     - 如果是 "file:../path" → 从本地路径复制
  4. 自动执行 adapt
```

### 2.3 `esl adapt` 新增

#### 命令形式

```bash
esl adapt              # 项目级：.skills/ → 各 AI 工具目录
esl adapt --global     # 全局级：~/.skill-library/skills/ → 各 AI 工具全局目录
```

#### 执行流程

```
esl adapt
  1. 读取全局 config.json → tools 列表（如 ["claude", "codex"]）
  2. 读取 .skills.json → 检查是否有项目级 tools 覆盖
  3. 扫描 .skills/ 下所有技能目录
  4. 对每个 ToolAdapter：
     a. clean → 清空目标目录下 ESL 管理的文件
     b. 对每个技能：复制文件到目标目录，设为只读
  5. 输出日志：同步了 N 个技能到 M 个工具
```

#### 幂等性

`adapt` 任意时刻执行结果一致——先 clean 再全量复制，不做增量对比。简单可靠。

### 2.4 `esl update` 新增

#### 命令形式

```bash
esl update                        # 更新所有技能到 semver 允许的最新版本
esl update @scope/my-skill        # 只更新指定技能
esl update --global               # 更新全局技能
```

#### 执行流程

```
esl update
  1. 读取 .skills.json → 获取依赖列表
  2. 跳过 "file:" 本地路径的依赖
  3. 对每个远程依赖：
     a. 调用 API 查询最新版本
     b. 对比 .skills-lock.json 中的当前版本
     c. 在 semver 范围内选最新（如 "^1.0.0" 允许 1.x.x）
     d. 如果有新版本：重新 clone → 复制 → 更新 lock 文件
  4. 自动执行 adapt
  5. 输出更新摘要
```

### 2.5 `esl clone` 新增

#### 命令形式

```bash
esl clone @scope/my-skill               # 克隆到 ./my-skill/
esl clone @scope/my-skill ./custom-dir   # 克隆到指定目录
```

#### 执行流程

```
esl clone @scope/my-skill
  1. 调用 API GET /api/skills/@scope/my-skill → 获取 gitRepoPath
  2. 构造带 Token 认证的 Git URL
  3. git clone（保留完整 .git/）到目标目录
  4. 输出提示："克隆完成，可在 ./my-skill/ 中编辑"
```

#### 与 `install` 的区别

| 维度 | `install` | `clone` |
|---|---|---|
| 目的 | 使用技能 | 参与开发 |
| 目标位置 | 项目 `.skills/` | 当前目录 `./skill-name/` |
| 保留 `.git/` | 否 | 是 |
| 文件权限 | 只读 | 可编辑 |
| 写入 `.skills.json` | 是 | 否 |

### 2.6 `esl uninstall` 新增

#### 命令形式

```bash
esl uninstall @scope/my-skill             # 从项目卸载
esl uninstall --global @scope/my-skill    # 从全局卸载
```

#### 执行流程

```
esl uninstall @scope/my-skill
  1. 删除 .skills/@scope/my-skill/ 目录
  2. 从 .skills.json 移除该条目
  3. 从 .skills-lock.json 移除该条目
  4. 自动执行 adapt（清理各 AI 工具目录中的副本）
```

---

## 3. 适配引擎（Adapt Engine）

### 3.1 ToolAdapter 接口

```typescript
interface ToolAdapter {
  name: string;                              // "claude" | "codex" | "trae"
  projectDir(root: string): string;          // 项目级目标目录
  globalDir(): string;                       // 全局级目标目录
  adapt(skillPath: string, targetDir: string): Promise<void>;  // 复制技能
  clean(targetDir: string): Promise<void>;   // 清理旧文件
}
```

### 3.2 各工具目录映射

| 工具 | 项目级目标 | 全局级目标 |
|---|---|---|
| Claude Code | `{root}/.claude/skills/{name}/` | `~/.claude/skills/{name}/` |
| Codex | `{root}/.agents/skills/{name}/` | `~/.agents/skills/{name}/` |
| TRAE | `{root}/.trae/skills/{name}/` | `~/.trae/skills/{name}/` |

### 3.3 工具检测策略

- 全局 `~/.skill-library/config.json` 的 `tools` 字段指定默认工具列表
- 项目 `.skills.json` 的 `tools` 字段可覆盖全局配置
- 用户通过 `esl config set tools claude,codex` 设置全局默认

### 3.4 只读保护

复制后将目标文件设为只读（`fs.chmod(file, 0o444)`），防止用户在 AI 工具目录里误改。修改应回到技能源头。

---

## 4. 依赖管理文件

### 4.1 `.skills.json`

```json
{
  "skills": {
    "@scope/react-skill": "^1.0.0",
    "@scope/coding-standards": "^2.1.0",
    "@scope/my-dev-skill": "file:../my-skill"
  },
  "tools": ["claude", "codex"]
}
```

- `skills` — 技能依赖列表（类似 `package.json` 的 `dependencies`）
- `tools` — 可选，覆盖全局 config 的工具列表

### 4.2 `.skills-lock.json`

```json
{
  "lockfileVersion": 1,
  "skills": {
    "@scope/react-skill": {
      "version": "1.0.3",
      "resolved": "esl-skills/scope_react-skill",
      "integrity": "sha256-xxxx"
    },
    "@scope/coding-standards": {
      "version": "2.1.0",
      "resolved": "esl-skills/scope_coding-standards",
      "integrity": "sha256-yyyy"
    }
  }
}
```

- 只记录从服务器安装的技能（`file:` 路径的不记录）
- `integrity` 用于校验文件完整性

### 4.3 Git 管理策略

- `.skills/` **不提交**到 git（类似 `node_modules/`）
- `.skills.json` + `.skills-lock.json` **提交**到 git
- 团队成员 clone 项目后执行 `esl install` 恢复所有技能
- AI 工具目录（`.claude/skills/` 等）**不提交**到 git

首次 `esl install` 时自动追加到 `.gitignore`：

```gitignore
# ESL managed (do not edit)
.skills/
.claude/skills/
.agents/skills/
.trae/skills/
```

---

## 5. 三种角色的完整工作流

### 5.1 创建者

```bash
esl init @scope/my-skill        # 创建技能
# 开发...
esl publish                      # 发布到服务器
```

### 5.2 协作者

```bash
esl clone @scope/my-skill       # 克隆源码到 ./my-skill/（完整 git 仓库）
# 编辑修改...
cd ~/project-a
esl install ../my-skill          # 在项目里测试（复制到 .skills/，自动 adapt）
# 测试通过
cd ~/my-skill
git push && esl publish          # 推送并发布新版本
```

### 5.3 使用者

```bash
esl install @scope/my-skill     # 安装到项目（自动 adapt 到 AI 工具）
# 后续...
esl update                       # 更新到最新版本
```

---

## 6. 错误处理

### 6.1 `install` 边界情况

| 场景 | 处理方式 |
|---|---|
| `.skills/` 中已存在同名技能 | 覆盖安装，提示版本变化 |
| 本地路径不存在 | 报错退出 |
| 本地路径校验不通过 | 报错退出，显示具体错误 |
| 服务器不可达 | 报错退出 |
| 指定版本不存在 | 报错退出 |
| 未登录 | 报错提示执行 `esl login` |
| 项目无 `.skills.json`（首次） | 自动创建 |

### 6.2 `adapt` 边界情况

| 场景 | 处理方式 |
|---|---|
| 全局 config 未配置 tools | 报错提示配置 |
| 目标目录不存在 | 自动创建 |
| 只读设置失败 | 警告但不中断 |
| `.skills/` 为空 | 执行 clean，提示无技能 |

### 6.3 `update` 边界情况

| 场景 | 处理方式 |
|---|---|
| 所有技能已最新 | 提示已最新 |
| 部分更新失败 | 不回滚已成功的，报错失败的 |
| `file:` 路径依赖 | 跳过并提示 |

---

## 7. 代码结构

### 7.1 新增/变更文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/adapt/tool-adapter.ts` | ToolAdapter 接口定义 |
| `packages/core/src/adapt/claude-adapter.ts` | Claude Code 适配器 |
| `packages/core/src/adapt/codex-adapter.ts` | Codex 适配器 |
| `packages/core/src/adapt/trae-adapter.ts` | TRAE 适配器 |
| `packages/core/src/adapt/adapt-engine.ts` | 适配引擎主逻辑 |
| `packages/core/src/adapt/index.ts` | adapt 模块导出 |
| `packages/core/src/store/skills-json.ts` | `.skills.json` / `.skills-lock.json` 读写 |
| `packages/core/src/store/file-copy.ts` | 文件复制 + 只读设置工具函数 |
| `packages/cli/src/commands/adapt.ts` | adapt 命令 |
| `packages/cli/src/commands/update.ts` | update 命令 |
| `packages/cli/src/commands/clone.ts` | clone 命令 |
| `packages/cli/src/commands/uninstall.ts` | uninstall 命令 |
| `packages/cli/src/commands/install.ts` | 改造：项目级默认 + 本地路径 + 自动 adapt |

### 7.2 测试策略

| 层级 | 覆盖范围 | 方式 |
|---|---|---|
| 单元测试 | ToolAdapter 各实现、`.skills.json` 解析、文件复制逻辑 | vitest，mock 文件系统 |
| 集成测试 | `install` / `adapt` / `update` / `clone` / `uninstall` 完整流程 | vitest，临时目录 + mock API |
| 现有测试 | 保持 `validateSkillDirectory`、`validateSkillJson` 等已有测试不变 | 不改动 |

核心包拆分遵循项目规范：
- **`packages/core`** — ToolAdapter 接口及实现、`.skills.json` 读写逻辑、文件复制与只读设置
- **`packages/cli`** — 各命令的 CLI 入口、参数解析、输出与退出行为
