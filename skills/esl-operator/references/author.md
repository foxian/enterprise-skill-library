# 作者工作流：定义 / 创建 / 校验 / 上传 / 发布 / 维护

本页是作者命令参考。面向用户目标的阶段路径见 `references/workflows.md`。作者任务必须明确区分：本地源码、Server-hosted Source、未发布 Release 和可安装的 Published Release。

## 生命周期总览

```text
需求定义
  → source init / 接入已有目录
  → 编写与本地试跑
  → source validate
  → source upload        # 登记或同步源码，不等于发布
  → release version      # 准备不可变版本
  → release publish      # 进入 Registry，可被消费者安装
  → notes / deprecate / delete（发布后治理）
```

上传源码不会自动让普通用户可安装；发布版本也不会替代源码校验。任何阶段失败都停在当前阶段，不跳过检查强行继续。

只读命令：`esl source validate`、`esl source status`。
写命令：`esl source init`、`esl release version`、`esl source clone`、`esl source reset`、`esl source upload`、`esl release publish`、`esl release deprecate`、`esl release notes`、`esl release delete`、`esl skill share`、`esl release depend add/remove`。写命令先回显完整命令、说明影响并等待用户确认。

## 开始前：先定义技能，不要先跑 init

在从零创建前，先收集足以指导实现的信息：

- 要解决的问题和目标用户；
- 触发场景；
- 输入、输出和成功标准；
- 不应该做什么、边界和安全限制；
- 一个最小成功示例和一个失败/边界示例；
- 是否只本地使用，还是最终上传给个人/组织；
- 组织 namespace、可见性和共享对象（若计划发布）。

如果用户已有明确目录或 `SKILL.md`，不要重新初始化覆盖；先识别目录和源码状态。

## 从零初始化

`esl source init [./path] [--name <短名>] [--namespace <namespace>] [--license SPDX] [--description <text>] [--keywords a,b] [--display-name <显示名>] --agent-interaction --agent-tool <tool>`

`source init` 会就地补缺，不覆盖已有文件：缺少 `SKILL.md` 时创建基本 frontmatter；缺少 `release.json` 时补最小 v4 清单；不生成 `skill.json`，因为 `skill.json` 属于安装/发布包而非源码。

执行前确认：目标目录、短名、个人或组织 namespace、description、license、keywords、display name。AI 执行时固定带 `--agent-interaction --agent-tool <tool>`；缺失字段由 CLI 返回结构化问题，再向用户收集后用同一命令重跑。不要猜组织名，也不要替用户确认首次身份。

身份规则：`SKILL.md.name` 是短名；`release.json.name` 是归属与完整身份的权威来源。个人可用裸短名，组织使用 `@组织名/短名`。首次 `source upload` 会固定身份；后续不要靠修改 `release.json.name` 迁移 namespace。

## 已有目录：接入而不是重建

如果目录已有 `SKILL.md`：

1. 检查当前目录和上级是否为 Git 仓库；
2. 检查 `release.json`、`esl` remote 和 `source status`；
3. 执行 `esl source validate ./path`；
4. 判断用户要仅本地使用、上传同步，还是创建发布版本。

已有 `SKILL.md` 不代表源已托管；已有 `release.json` 也不代表版本已发布。先读取状态再决定下一步。

## 目录选择：全局 `-C`

`esl -C <dir> <command>`（长写 `--cd <dir>`）先切换工作目录后执行命令。相对 `-C` 的路径按切换前 cwd 解析；切换后的位置路径按新 cwd 解析。目录类命令优先使用位置路径或 `-C`，不要使用已移除的 `--directory`。

## 校验与质量审查

`esl source validate [./path]` 只读校验源码结构、`SKILL.md` frontmatter 和 release manifest；它不等于内容质量审查，也不会替用户判断技能是否值得发布。

校验通过后仍要人工/AI 审查：

- description 是否准确、可触发、不过度宽泛；
- instructions 是否能让目标用户完成任务；
- 输入输出和边界是否明确；
- 示例是否能复现；
- 是否包含秘密、本机路径或不应共享的内容；
- references 是否按需拆分，避免主文件过长。

**完成标准**：结构校验成功，内容审查通过，并用最小案例完成一次本地试跑。只有这三项都满足才进入 upload。

## 本地试跑

使用 `esl skill use ./path` 输出本地 Prompt，或将其管道给目标 Agent；它不上传、不发布、不修改 Server。试跑用于验证技能行为，不替代 `source validate`。

## 查看源码托管状态

`esl source status [./path]` 只读显示工作树、提交、本地与 Server 的领先/落后和托管状态。未托管时会提示先 `source upload`。如果用户只想本地使用，看到未托管可以正常停止，不要擅自上传。

## 上传源码：建立或同步维护源

`esl source upload [./path] [--message|-m <text>] [--license SPDX] [--confirm-identity <技能名>]`

上传会在 Server 登记或同步技能源码、建立/更新 Server-hosted Source，并使用 Git remote 推送。它不是发布；用户仍需要后续 `release version` 与 `release publish` 才能让版本进入可安装 Registry。

上传前检查：

- 不是 `@builtin/*` 或 `@local/*`；
- `source validate` 成功；
- namespace、短名、display name 和 description 正确；
- 当前账号对目标 namespace 有权限；
- 工作树、commit、remote 和 push 状态符合预期；
- 未包含密码、token、密钥或敏感本机文件。

首次上传的完整身份必须确认；非交互场景使用与 `release.json.name` 完全一致的 `--confirm-identity`。已托管源不要通过改 manifest 强行迁移 namespace。

## 版本：生成不可变 Release

`esl release version [patch|minor|major|<SemVer>]`（在目标源码目录执行；需要切换目录时用全局 `-C, --cd <path>`）

标准顺序是：先提交源码，再生成版本。工作树有未提交改动时停止并要求用户提交或 stash，避免无关改动被卷入版本。

- `patch`：向后兼容的修复；
- `minor`：新增兼容能力；
- `major`：不兼容变更；
- 显式 SemVer：用户明确指定版本时使用。

版本号一旦发布不可覆盖或复用；内置 `@builtin/*` 技能版本由 ESL CLI 版本锁定，不走此流程。

## 发布：让消费者可安装

`esl release publish [./path] [--dry-run]`

发布前再次确认：技能身份、版本、namespace、可见性、依赖锁、release notes 和“其他用户将可以看到并安装”。优先使用 `--dry-run` 预演（若用户只想检查，不等于发布）。发布会校验源码已同步、身份一致、依赖可解析，并将 Release 置为 Registry 可安装状态。

发布后使用 `esl skill info @scope/name --json` 或 `esl skill search @scope/name --json` 闭环验证。只能在查询到正确版本后报告“已发布”；仅 upload 成功只能报告“源码已同步”。

## 发布依赖

`esl release depend add @scope/dependency[@<semver-range>] [./path]`
`esl release depend remove @scope/dependency [./path]`
`esl release depend list [./path]`（父命令 `depend` 不带子命令也表示 list）

依赖是 Release 安装图的一部分：添加/删除会影响后续发布和消费者安装解析。修改前展示完整命令、依赖身份与版本范围并确认；发布后依赖通过 Release Lock 固定，不能把未锁定的新依赖偷偷混入已有版本。

## 发布后治理

- `esl release notes @scope/name <version> --message "说明"`：修改 Release notes，不改发布包内容。
- `esl release deprecate @scope/name <version> --message "说明"`：标记不推荐但仍可安装；解除标记传空 message。
- `esl release delete @scope/name <version> --confirm <version>`：删除指定 Release。版本号烧毁、不可重发；仅在内容必须消失（如误发密钥）时使用，先说明影响。若仍被依赖锁引用，不要默认加 `--force`。
- `esl release repair-tag @scope/name <version>`：仅在服务器报告 Tag 缺失/损坏时使用的运维修复。

## 二次开发已有技能

- 只想阅读/试用：`esl skill use @scope/name`；
- 想修改源码：`esl source clone @scope/name ./target`；
- 修改后：`source validate` → `source status` → 根据权限决定 upload/publish。

不要把已安装 Store 副本当成维护源；不要修改 `release.json.name` 伪造跨 namespace 归属。

## 重置与重命名

- `esl source reset [./path] --force`：只在确认服务器源已删除、需要按新 Skill ID 重建时使用。它不删除服务器资源，也不应作为“换账号”或“修权限”手段。
- `esl source rename @scope/old-name <new-name>`：对已托管技能执行正式重命名；不要靠修改 `SKILL.md.name` 或 `release.json.name` 实现。

## 共享与权限

`esl skill share @scope/name --all [--write]`
`esl skill share @scope/name --team <team> [--write|--manage]`
`esl skill share @scope/name --user <username> [--write]`
`esl skill share @scope/name --reset`

先确认组织、目标（全员/团队/成员）和权限等级（只读/读写/管理）。这是远端权限变更，执行前回显完整命令并确认；完成后复核实际授权范围。403 表示权限不足，不要盲目重试或升级权限。

## 作者任务完成报告

完成后准确说明所处阶段：

- 本地源码已初始化 / 已校验；
- 源码已上传并托管；
- Release 已生成；
- Release 已发布并可安装；
- 共享权限已更新；
- 验证命令和结果；
- 仍需用户执行的下一步。

不要把 `source upload` 报告为“已发布”，也不要把 `source validate` 报告为“质量保证”。
