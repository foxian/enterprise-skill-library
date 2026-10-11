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
写命令：`esl source init`、`esl release version`、`esl source clone`、`esl source reset`、`esl source export`、`esl source clean`、`esl source upload`、`esl release publish`、`esl release deprecate`、`esl release notes`、`esl release delete`、`esl skill share`、`esl release depend add/remove`。写命令先回显完整命令、说明影响并等待用户确认。

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

### 上传前：盘点文件，先问再传

在回显 `source upload` 之前，列出技能目录里将被提交/打包的文件（跳过 `.git`），按三类给用户看，**等用户确认保留集之后**才进入写命令：

1. **建议保留**：`SKILL.md`、`release.json`、`.gitignore`，以及 `SKILL.md` / references 明确引用的 scripts、references、assets。
2. **建议排除（默认不上传）**：`__pycache__/`、`*.pyc`、`.pytest_cache/`、`.venv/`、`node_modules/`、`.DS_Store`、job JSON、`*.log`、下载成品（如 `*.mp4`）、编辑器/运行时残留。
3. **必须询问**：`archive/` 或其它留档、示例数据、未在文档中引用的脚本、本机路径配置、体积明显偏大的文件。说明该文件对消费者是否必要、排除后技能还能否按文档执行。

用户确认后，把排除项写入 `.gitignore`，并从磁盘删除仍会妨碍发布的文件：`esl release publish` 遍历工作区、只跳过 `.git`，**不遵守** `.gitignore`。不要替用户默默删掉第 3 类文件。

上传前其余检查：

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

发布前再次确认：技能身份、版本、namespace、可见性、依赖锁、release notes 和“其他用户将可以看到并安装”。沿用上传时用户确认过的保留集，再扫一遍磁盘，确认排除项没有回到工作区。

`--dry-run` 只在用户只要预演、还不发布时使用；它同样把工作区 POST 到 Server 做冻锁校验，并不更快。用户已确认发布时，Agent 直接 `esl release publish <path> --force -m "..."`，不要先 dry-run 再正式发一遍。非交互环境没有 `--force` 会在确认提示上卡住。

发布会校验源码已同步、身份一致、依赖可解析，并将 Release 置为 Registry 可安装状态。

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
- `esl source clean [./path] --force`：原地删除 `.git`、`release.json` 和 `release.json.before-reset`，保留 `SKILL.md` 与技能正文。只在用户明确要求把当前目录清成无 Git/ESL 身份时使用；非交互必须 `--force`。不要用它做跨实例分发（应 `source export`），也不要用它代替 `source reset`。
- `esl source rename @scope/old-name <new-name>`：对已托管技能执行正式重命名；不要靠修改 `SKILL.md.name` 或 `release.json.name` 实现。

## 共享治理：授权与可见性

三件事互不相同（ADR-0062），别把它们当成一个“共享状态”：

| 看什么 | 命令 |
|---|---|
| **当前授权**（权限矩阵，只读） | `esl skill share @scope/name` |
| 全组织授权（常设团队档位） | `esl skill share @scope/name --all [--write\|--manage]` |
| 团队授权 | `esl skill share @scope/name --team <team> [--write\|--manage]` |
| 成员授权 | `esl skill share @scope/name --user <username> [--write\|--manage]` |
| 撤销团队授权 | `esl skill share @scope/name --revoke-team <team>` |
| 撤销成员授权 | `esl skill share @scope/name --revoke-user <username>` |
| 清空全部显式授权 | `esl skill share @scope/name --clear-grants` |
| **可见性**（public/private） | `esl skill share @scope/name --visibility public\|private` |

不带任何目标旗标是**只读**的：直接跑，把矩阵读给用户（可见性 / 全组织授权 / 团队授权 / 成员授权）。其余都是远端变更：先回显完整命令并确认，完成后复核实际范围。一次只能带一个目标旗标；`--write` / `--manage` 只作用于 `--all` / `--team` / `--user`。

`--clear-grants` 会先二次确认，提示会说明清空的是哪些授权；非交互环境必须显式加 `--force`——**先拿到用户同意再带上它**。它只清空该技能的显式团队与成员授权：**不改变可见性**，也不撤销所有者、Maintainer 或管理员基于角色获得的权限。不要把它说成“设为私有”，也不要用它代替 `--visibility private`。同理，切可见性不增删任何授权。

403 表示权限不足，不要盲目重试或升级权限。

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

## 跨实例播种：导出独立维护副本

`esl source export [./path] [--output <directory>]` 是本地写命令：源目录必须是干净、已提交的技能 Git 仓库根；默认在源目录同级生成 `<短名>-export/`。只导出 HEAD 中已跟踪文件，不带 `.git`、Git remote 或历史；源目录不变、已有目标目录不覆盖，不需要 Server 或登录。执行前回显输出路径并确认；导出后审查内容（不会自动删掉普通文件中可能含有的敏感信息）。

副本 `release.json.name` 自动变成裸短名，其他通用元数据保留。目标企业 Maintainer 若需要组织归属，必须在其首次上传前将副本的 `release.json.name` 改为 `@目标组织/短名`，然后运行 `esl source upload <副本> --confirm-identity @目标组织/短名`。裸名上传归个人命名空间。各实例分别生成 Skill ID，并独立维护更新。不要把 `source reset`、`source clean`、`git clean` 或手工删除源目录 `.git` 当作分发步骤。用户若只要把当前目录去身份，才使用 `source clean`。
