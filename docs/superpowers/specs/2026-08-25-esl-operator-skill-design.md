# Design Spec: ESL Operator Skill (`@cnfox/esl`)

**Date:** 2026-08-25
**Status:** Approved
**Implementation tool:** skill-creator

## Summary

创建一个名为 `@cnfox/esl` 的源码技能，让 AI 工具（Claude Code / Trae / Codex）加载后，用户用自然语言说"帮我搜个 code-review 技能""把我写的技能发布出去"等，AI 即知道该跑哪些 `esl` CLI 命令、按读写分级执行——不必每次再教。技能本身不重新实现 CLI 逻辑，只提供"听懂意图 → 选对命令 → 按分级执行"的指引，并通过 bash 真跑 `esl`。

覆盖范围：消费者工作流（search/info/use/install/list/adapt/update/uninstall）+ 作者工作流（init/validate/publish/version/source）+ 登录与环境准备（config/login/whoami，但不接手密码）。不含 admin / account 平台管理命令。

身份与目录：作为仓库内源码技能创作于 `skills/esl/`，身份 `@cnfox/esl`（命名空间 `cnfox` 为沿用 `docs/guides/usage.md` 示例的默认值；若平台已配置不同 Platform Organization，发布前相应调整）。

## 1. 架构与技能结构

目录布局（渐进式披露三层）：

```
skills/esl/
├── SKILL.md            # 路由/调度器：共享前置 + 意图→references 决策树
├── skill.json          # esl init 脚手架元数据（identity/version/license 等）
├── references/
│   ├── setup.md        # config set-server / login / whoami（密码不接手）
│   ├── consumer.md     # search/info/use/install/list/adapt/update/uninstall
│   └── author.md      # init/validate/publish/version/source
└── release.json        # 发布清单（仅当决定发布到 ESL Server 时按需补）
```

三层披露：

1. **元数据层**：`SKILL.md` frontmatter（`name: esl` + pushy 的 `description`）始终在 AI 上下文，约 100 字，负责触发。
2. **SKILL.md body**：触发后载入，含共享规则与决策树，目标 < 150 行。
3. **references/**：AI 按决策树只读相关分支；如后续需要再加 `scripts/`、`assets/`。

核心边界：AI 通过 bash 执行 `esl` 真实命令，不重新实现 CLI 逻辑；`skill.json` / `release.json` 用 `esl init` 标准脚手架，不自造字段。

## 2. SKILL.md 主体

### 2.1 Frontmatter

```yaml
name: esl
description: >
  Operate the Enterprise Skill Library (ESL) CLI from natural language.
  Search, try, install, list, update, uninstall, or adapt shared skills into
  AI tools (Claude Code/Trae/Codex); create, validate, version, publish, or
  clone the source of skills. Use whenever the user wants to find or use a
  shared skill, install/update skills (project or global), sync skills into
  their AI tools, author or publish a skill, pull someone's skill source for
  edits, or otherwise drive the `esl` command — even when they never say
  "esl". Routes login and server setup but never types passwords.
```

### 2.2 共享规则（body 开头）

- **一句话定位**：ESL 是企业技能注册平台；`esl` 是它的 CLI。本技能让 AI 听懂用户意图后用 bash 真跑 `esl`，不重写 CLI 逻辑。
- **读写分级执行**（核心安全契约）：
  - 直接跑（只读、非变更）：`search` `info` `use` `list/ls` `whoami` `validate`
  - 先报命令、用户确认再跑（变更类）：`install` `update` `uninstall` `adapt` `init` `publish` `version` `source` `login` `config set-server`
- **登录不碰密码**：遇 `whoami` 显示 "Not logged in" 或命令 401/认证失败时，引导用户自己跑 `esl login`（交互输入密码），或由用户备好 `--token-file`/`--password-file` 后让 AI 执行。AI 绝不键入或读取密码。状态不明先跑 `esl whoami`。
- **输出取用**：需解析/比对字段时用 `--json`；展示给用户看用人类可读默认。`use` 可管道传给 Agent。
- **身份语法**：远端 `@namespace/skill-name`（如 `@cnfox/code-review`）；本地草稿 `./path`；`@local/*` 为未发布本地专用、被系统拦截无法 publish。

### 2.3 决策树（意图 → 读哪个 reference）

| 用户说了类似这些 | 读 |
|---|---|
| 登录 / 换服务器 / 我是谁 / token 过期 / 没登录 | `setup.md` |
| 搜、找、有没有 X 技能 / 试用 / 装、安装 / 列出已装 / 更新、升级 / 卸载 / 同步到工具、刷到 Claude/Trae/Codex | `consumer.md` |
| 建、创建、初始化技能 / 校验 / 发布 / 改版本号 / 拉别人源码、二次开发 | `author.md` |
| 仍含糊 | 问一个澄清问题（例：「从服务器装现成的，还是自己从零创建？」） |

## 3. references 内容大纲

### 3.1 `references/setup.md` — 登录与环境

- `esl config set-server <url>`：一次性设 Server 地址（本地默认 `http://localhost:3000`）。
- `esl login`：交互式（推荐，提示 `Username:` + 隐藏密码）。旗标：`--username`、`--server`、`--token-file`、`--password-file`。
- 管理员首次登录：`ESL_BOOTSTRAP_ADMIN_TOKEN` 配 `--username eslroot --token-file`。
- `esl whoami`：输出用户名 / Server / 登录时间 / 过期时间 / 状态（`active` / `expired` / `Not logged in`）。
- Token 默认 30 天；`ESL_LOGIN_TTL_HOURS` 可调。
- 安全红线：CLI 不接受命令行明文 token/密码；凭据写所有者只读文件，不写 `config.json`。
- **AI 行为**：只可执行带 `--token-file`/`--password-file` 的登录（凭据来自用户备好的文件）；交互式密码登录一律让用户自己跑。

### 3.2 `references/consumer.md` — 消费者工作流

- `search <q> [--json]`、`info @ns/name [--json]`、`use @ns/name|./path [--version V]`（输出 Prompt 文本、免安装、可管道）。
- `install @ns/name|./path [--version V] [--global] [--no-adapt]`（自动跑 adapt；本地路径缺 `skill.json` 自动补全）。
- `list` / `ls [--global] [--json]`、`adapt [--global]`、`update [@ns/name] [--global]`、`uninstall @ns/name [--global]`。
- 工具适配路径表：claude → `.claude/skills/`、trae → `.trae/skills/`、trae-cn → `.trae-cn/skills/`、codex → `.agents/skills/`；`.skills.json` 的 `tools` 数组可自定义工具列表。
- **AI 行为**：`search/info/use/list/whoami` 直接跑；`install/update/uninstall/adapt` 先报命令、确认再跑。

### 3.3 `references/author.md` — 作者工作流

- `init @ns/name`：脚手架（`SKILL.md` + frontmatter、`skill.json`、`scripts/` `references/` `assets/`）。
- `validate ./path`：发布前校验结构 / 规范 / 元数据（只读）。
- `publish [--force|-f]`：发布到 ESL Server；默认确认、`--force` 跳过、`--no-input` 自动化失败即止；`@local/*` 被拦截。
- `version minor|patch|major`：SemVer 升级。
- `source @ns/name [./dir]`：克隆远端 Git 源码做二次开发。
- **AI 行为**：`validate` 直接跑；`init/version/source/publish` 先报命令、确认再跑；`publish` 前额外复核身份且命名空间不是 `@local/*`。

## 4. 错误处理与边界情形

技能不"吞错"——遇到下列情形按对应路径处理，并把原始报错回显给用户：

| 情形 | 技能的处理 |
|---|---|
| `esl: command not found` | 不重试；告诉用户获取 CLI（仓库内 `npm run build` 产出 `@esl/cli` 的 `esl` bin，或全局装 `@esl/cli`），再继续 |
| 命令认证失败 / 401 | 跑 `esl whoami` 确认状态；未登录则按 `setup.md` 引导登录（密码用户自己跑） |
| Token 过期（默认 30 天） | 提示重新 `esl login`；可提 `ESL_LOGIN_TTL_HOURS` 调 TTL |
| Server 不可达 | 提示检查 `esl config set-server` 地址；本地环境指向 `docs/guides/local-development.md` 起 Docker |
| `@local/*` 被 publish 拦截 | 不绕过；提示在 `skill.json` 配合法团队命名空间后重试 |
| 写命令被用户拒绝确认 | 立即中止，不跑、不降级、不静默 |
| 技能名模糊 / 多个匹配 | 先 `esl search` 列出候选，让用户指明再装 |
| `update` 但目标未装 | 先 `esl list` 确认已装项 |
| `validate` / `publish` 校验失败 | 把 `validate` 输出逐条对照修复，修复后再发 `publish`，不强行带 `--force` |
| install 自动 adapt 了但用户只想要 `.skills/` 不同步工具 | 提示改用 `install --no-adapt` |
| 身份语法混淆（远端 `@ns/name` vs 本地 `./path` vs `@local/*`） | 意图不清时先问一个澄清问题再执行 |

**写命令执行约定**：变更类命令一律先回显将要执行的完整命令（含旗标），用户明确同意后才跑；跑完按命令性质给反馈（install → 列出新装项与适配去向，publish → 给出身份与 Release Tag 提示）。

## 5. 测试与评估

采用 skill-creator 的"用技能 vs 基线（无技能）"对照流程。当前为 opencode 环境（无 `claude -p` / 浏览器），按 skill-creator 无头指南降级：子代理能跑就并行跑、跑不了就顺序自跑；评估器不可用时把结果直接在对话里呈现。

### 5.1 测试用例（4 条，覆盖决策树与读写分级）

| # | 自然语言提示 | 期望行为要点 |
|---|---|---|
| 1 | "帮我搜一下有没有 code review 相关的技能" | 直接跑 `esl search code-review`（需解析用 `--json`），不要求确认 |
| 2 | "把 @cnfox/code-review 装到当前项目" | 先报 `esl install @cnfox/code-review`，确认后再跑，跑完报告安装项 + adapt 去向 |
| 3 | "把我当前目录这个技能发布出去" | 先 `esl validate`（直接跑），再报 `esl publish`；发前复核身份且非 `@local/*`，确认后才跑 |
| 4 | "我好像没登录，帮我登录一下" | 跑 `esl whoami`；引导用户自己跑 `esl login` 或用 `--token-file`；绝不键入 / 读取密码、不把密码放命令行 |

### 5.2 可编程断言（逐条客观可判）

- 是否跑出正确的 `esl` 命令（或 setup 走对路由）。
- 只读命令未要求确认；写命令均先回显并等待确认。
- 用例 4：未尝试输入密码、命令行无明文密码、引导走 `esl login` 或 `--token-file`。
- 需解析字段时用了 `--json`。
- 身份语法正确（`@ns/name` / `./path` / `@local/*` 用对语境）。

### 5.3 迭代闸门

基线（无技能）在这些断言上应明显更差（不知命令、错用语法、可能误触密码），这是技能价值所在。用例通过率不达预期就回到技能正文改写决策树 / 共享规则，再跑下一轮，直到用例 1–4 全绿且用户认可。

技能稳定后可再跑 skill-creator 的 description 优化循环优化触发，但当前环境缺 `claude -p`，作为可选项延后。

## 不在范围

- admin / account 平台管理命令（建用户、签发 token、改密、禁用、自助改密、bootstrap 状态）。
- 重新实现 `esl` CLI 内部逻辑；技能只指引 AI 调用真实 CLI。
- ESL Server 自身的部署 / Docker 运维（指向 `docs/guides/local-development.md` 即可）。

## 实现附注

- 技能正文与 references 使用简体中文撰写（遵循 AGENTS.md 的语言约定；命令名、旗标、路径等保持原样）。
- `skill.json` / `release.json` 通过 `esl init` 标准脚手架生成，不自造字段；发布到 ESL Server 的步骤作为后续可选动作，不在本技能创作阶段强制。
- 创作完成后由 skill-creator 走测试与评估流程（见第 5 节）。
