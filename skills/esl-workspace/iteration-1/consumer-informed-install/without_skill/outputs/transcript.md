# Transcript — 查找 demo 技能并安装最新版本到当前项目

- 时间：2026-08-25
- 操作目录：`D:\DevProjects\enterprise-skill-library\skills\esl-workspace\fixtures\consumer-project`
- 登录用户：`consumer`（status: active），ESL Server: http://localhost:3000
- 运行模式：自治模式。只读命令已直接执行；写/状态变更命令（install）仅提出建议命令并停止，未执行。

## 用户请求

> 帮我找 demo 相关的技能，挑最新版本装到当前项目，并说清确认后会同步到哪些工具目录。

## 已执行的命令（只读）

### 1. 确认登录身份

```
esl whoami
```

输出：

```
Username: consumer
Server: http://localhost:3000
Logged in at: 2026-08-25T10:35:11.646Z
Expires at: 2026-09-24T10:35:11.646Z
Status: active
```

### 2. 搜索 demo 相关技能

```
esl search demo
```

输出：

```
@esl-skills/demo-renamed	Shared demo skill
```

共命中 1 个技能：`@esl-skills/demo-renamed`（描述：Shared demo skill）。

### 3. 查看技能详情与可用版本

```
esl info @esl-skills/demo-renamed
```

输出：

```
Name: @esl-skills/demo-renamed
Description: Shared demo skill
Versions: 0.1.2, 0.1.1, 0.1.0
Repository: esl-skills/demo-renamed
```

三个版本，最新为 `0.1.2`。

### 4. 查看 install 命令用法

```
esl install --help
```

输出（要点）：

- 参数 `name-or-path`：技能名（`@namespace/skill`）或本地路径
- `--version <version>`：指定要安装的版本
- `--global`：安装到全局目录（默认装到当前项目）
- `--ignore-compatibility`：安装不兼容的已发布包
- `--no-adapt`：跳过安装后的自动 adapt（默认安装后会自动 adapt，即同步到 AI 工具目录）

### 5. 查看当前项目已安装技能

```
esl list
```

输出：`No skills installed in this project.`（当前项目尚未安装任何技能）

### 6. 查看 adapt 命令用法

```
esl adapt --help
```

要点：`Sync installed skills to AI tool directories`，默认按项目级处理；支持 `--global` / `--prune` / `--directory`。

## 推理过程

1. 关键字 `demo` 命中唯一技能 `@esl-skills/demo-renamed`，无需在多者间选择。
2. `esl info` 显示三个版本 `0.1.0 / 0.1.1 / 0.1.2`，按语义版本取最新 `0.1.2`。
3. 项目 `.skills.json` 内容为：
   ```json
   {
     "skills": {},
     "tools": ["claude", "trae", "codex"]
   }
   ```
   即项目声明了三项目标工具：`claude`、`trae`、`codex`。
4. 通过阅读适配器源码（`packages/core/src/adapt/`）确认每项工具的项目级目标目录：
   - `claude-adapter.ts:11` → `path.join(root, '.claude', 'skills')` → `.claude/skills/`
   - `trae-adapter.ts:11` → `path.join(root, '.trae', 'skills')` → `.trae/skills/`
   - `codex-adapter.ts:11` → `path.join(root, '.agents', 'skills')` → `.agents/skills/`
5. 通过阅读 `adapt-engine.ts` 确认适配后的目录命名规则（`adaptedSkillDirectoryName`，第 51-54 行）：
   - 对 identity `@esl-skills/demo-renamed`，scope=`esl-skills`、skillName=`demo-renamed`，故目录名为 `esl-skills_demo-renamed`；显示名为 `esl-skills:demo-renamed`。
6. `esl install` 默认在安装完成后自动 `adapt`（未加 `--no-adapt`），因此执行安装后会立刻把技能同步到上述三项目标工具目录。技能源文件本身被存入项目本地技能仓库 `.skills/`。

## 提议执行（写命令，未执行，待用户确认）

> 自治模式规则：install 属于写/状态变更命令，仅提出命令并停止，不直接执行。

在操作目录下运行：

```
esl install @esl-skills/demo-renamed --version 0.1.2
```

说明：不带 `--global`（装到当前项目），不带 `--no-adapt`（安装后自动同步到工具目录）。

## 确认后会同步到哪些工具目录

确认执行上述命令后，技能会落地到以下位置（均相对当前项目根目录）：

- 技能源仓库：`.skills/`（本地技能存储）
- AI 工具目录（adapt 同步，各含 `SKILL.md` 等技能文件）：
  - `.claude/skills/esl-skills_demo-renamed/`（Claude）
  - `.trae/skills/esl-skills_demo-renamed/`（Trae）
  - `.agents/skills/esl-skills_demo-renamed/`（Codex）

依据：项目 `.skills.json` 的 `tools` 字段为 `["claude", "trae", "codex"]`，三项适配器逐一对应以上目录。

## 最终给用户的回答

找到 1 个 demo 相关技能：`@esl-skills/demo-renamed`（Shared demo skill），可用版本 `0.1.0 / 0.1.1 / 0.1.2`，最新为 `0.1.2`。

提议在当前项目执行（写命令，待你确认后再运行）：

```
esl install @esl-skills/demo-renamed --version 0.1.2
```

确认后，技能会同步到当前项目的三项目标工具目录（由项目 `.skills.json` 的 `tools` 字段 `["claude","trae","codex"]` 决定）：

- `.claude/skills/esl-skills_demo-renamed/`
- `.trae/skills/esl-skills_demo-renamed/`
- `.agents/skills/esl-skills_demo-renamed/`

技能源文件同时存入项目本地仓库 `.skills/`。
