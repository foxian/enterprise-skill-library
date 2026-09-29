# 消费者工作流：找 / 装 / 链 / 看 / 更 / 卸

只读命令（直接跑）：`search` `info` `use` `list` `tools list`。
写命令（先回显、确认再跑）：`install` `link` `unlink` `update` `uninstall` `tools sync` `tools remove` `tools preferred`。

## 搜索
`esl search [query] [--namespace <org>] [--keyword <text>] [--visibility public|private] [--limit <n>] [--json]` —— 列出或查询 ESL Server 上**已发布且当前可安装**的技能。

- 不传 `query` 就是浏览全部可见技能；query 会匹配 Identity、描述、显示名（`displayName`，ADR-0048）和 keywords，`@scope/短名` 作技术名。
- `--namespace` 收窄组织/命名空间；`--keyword` 做硬过滤；`--visibility` 可选 `public` / `private`；`--limit` 控制条数（默认 50）。
- 匿名只能看到 public；登录后结果会附加用户有权读取的 private。匿名传 `--visibility private` 会明确报错并要求 `esl login`。
- 结果包含 `name`、`displayName`、`description`、`latestStableVersion`（不含 prerelease）和 `visibility`；`--json` 返回结构化数据。
- **AI/Agent 必须加 `--json`**，不要让 CLI 进入交互式 TTY 会话；拿到候选后按需用 `info` 复核，安装仍走 `install` 并遵守确认规则。
- 人类在交互式终端可不带 `--json` 使用 search：箭头选择技能、调整筛选、看详情；安装前 CLI 会回显完整 `esl install …` 并要求确认。`install` 本身不做远端目录浏览。

## 查看详情
`esl info @scope/skill-name [--json]` —— 技能的元数据、版本、源码信息；对外显示名（`displayName`，ADR-0048）也随详情返回。已登录时请求会带上当前 Skill User Token：private 技能对其维护账号与有权限成员可见；未登录只能看到 public 技能。

## 免安装试用
`esl use @scope/skill-name|./path [--version V]` —— 把技能 Prompt 文本打到 stdout，不安装、不改项目。可管道：`esl use @scope/skill-name | <agent>`。

## 安装
`esl install @scope/skill-name|./path [--version V] [--global|-g] [--tools all|工具列表] [--no-tools] [--force]`

- 从 Server 装最新或指定版本；`./path` 装本地草稿。来源由参数自动判断：`@scope/name` 走 Server、`@builtin/*` 走内置、`./path` 走本地路径。
- 本地 `./path` 的安装身份固定为 `@local/<name>`（保留 Scope，不可发布）；安装时在 Store 副本里补 `skill.json`，源目录不动。
- 项目级技能源写入 `<project>/.eslib/skills/@<scope>/<skill>/`；全局级写入 `~/.eslib/skills/@<scope>/<skill>/`。
- 项目根 `.skills.json` 是直接依赖声明；`.skills-lock.json` 是完整依赖图和精确版本锁。`.eslib/` 是本机状态，应保持 gitignore。
- 每个被选工具得到单技能目录 link，link 名使用 `<scope>_<skill>`，指向 `.eslib` 中的 `@<scope>/<skill>` 源；不复制技能，也不链接整个工具 skills 根目录。
- `--tools all` 选择全部九个工具；`--tools claude-code,codex` 选择指定工具；`--no-tools` 只装源、不建 link；`--force` 只能替换 ESL 记录的异常 link，不能覆盖非 ESL 内容。
- 未传 `--tools` 时：TTY 交互每次都弹工具勾选（预勾该技能已有 link；首次挂载预勾本机常用工具并说明），至少选一个，空选拒绝；非交互环境或 `--no-input` 使用全局配置的 `tools`，没有则报错而不要等待输入。项目 `.skills.json` 不再声明工具，遗留 `tools` 字段被忽略。
- `--tools` 与交互勾选都是该技能在该 Skill Store 上的**期望 Tool Link 集合**（ADR-0054）：补齐集合内，删除集合外 ESL 管理 link；集合内有冲突则保留旧项并失败。`--tools` 至少写一个工具名；`--no-tools` 不新建也不删除。
- 部分工具发生冲突或 link 创建失败时，已经写入的源和其他成功 link 保留，但命令以失败状态结束并给出冲突详情。
- TTY 覆盖确认顺序：模式转换（如把 Skill Source Link 换成正式副本）→ 覆盖安装 → 工具勾选。覆盖确认选否则中止并保持原安装；非交互与 Agent 模式覆盖静默进行。
- 安装报 403（`Forbidden: read access required`）时：说明该 private 技能可能由**其他账号/组织**维护。让用户切换到维护账号后重登，不要盲目重试。

## 本地源码开发链接

`esl link [./path] [--global|-g] [--identity @namespace] [--tools all|工具列表] [--no-tools] [--force]`

- 把本地技能源码目录链入 Skill Store：Store 位置指向源码，已有 Tool Link 继续指向 Store，形成“工具目录 → Skill Store → 本地源码”的两层链路。
- 身份来自 `release.json`：完整 `@scope/name` 原样使用；裸短名默认 `@local/<name>`；`--identity` 只能补 namespace 或给出短名一致的完整身份。
- `link` 不读取、不写入、不生成源码目录里的 `skill.json`；link 元数据记录在安装状态中。
- Store 中已有普通安装副本（改安装模式）：TTY 会先说明会把副本换成 Skill Source Link 并确认，同意后原副本移入 `.eslib/link-staging/`；非交互/Agent 无 `--force` 时报错，须带 `--force` 重跑。源码修改后，所有已链接工具立即看到。
- 同一源重复 link 是幂等的；换成另一个源必须 `--force`。
- 未传 `--tools` 时与 `install` 相同：TTY 每次勾选，非交互用全局配置 `tools` 或报错。

`esl unlink [@scope/skill-name|./path] [--global|-g]`

- 解除 Skill Source Link。有 staging 时纯本地恢复原副本和依赖/锁/安装状态；无 staging 时移除 link 和记录。
- staging 缺失或损坏时报错并保留 link 状态，不尝试联网恢复。
- **主推：** 显式 `@scope/skill-name`；已在技能目录且当初是 **global** link 时，可 `esl unlink --global`（省略身份，读当前目录 `release.json`）。
- **项目级：** 在**项目根**执行 `esl unlink ./相对路径`，或显式传身份。不承诺「cd 进技能子目录后做项目级裸 unlink」能找对 Store（CLI 不以技能目录向上查找 `.eslib`）。
- 非 `@` 参数一律视为路径。裸短名 `release.json.name` 按 `@local/<短名>` 推导。
- 若目录推出的身份与真实已 link 身份不一致，报错并列出真实身份；请改传显式 `@identity`。
- 进阶：`esl unlink -C <项目根> ./skills/foo`（`-C` 只改工作目录 / 项目根，位置路径决定读哪个技能目录）。

`esl uninstall` 对 link 技能只删除 Skill Store link、记录、Tool Link 和 staging，不会递归删除本地源码目录；`esl update` 会跳过 link 技能并报告 skipped。
`esl list` / `esl ls [--global|-g] [--json]` —— 当前项目或全局 Skill Store 中已安装的技能。

## 查看工具 link
`esl tools list [--tool <列表>] [--skill <列表>] [--global|-g|--project] [--managed|--unmanaged] [--status <状态列表>] [--json]`

- `linked`：link 存在且正确指向 Skill Store 源。
- `broken`：manifest 有记录，但 link 缺失或目标源不存在。
- `conflict`：目标存在，但不是预期的正确 ESL link。
- `source-only`：技能只在 Skill Store 中，没有工具 link。
- `unmanaged`：工具目录中存在，但不由 ESL manifest 管理。
- `--tool` 和 `--skill` 支持逗号分隔列表；`--status` 支持 `linked,broken,conflict,source-only,unmanaged`。
- 这个命令只读，直接运行；删除未管理内容仍必须由用户手工处理，ESL 不提供对应删除命令。

## 常用工具与 link 修复
`esl tools preferred [--add <tools>] [--remove <tools>] [--json]` —— 查看/编辑**本机常用工具**：只存本机客户端配置，不进项目依赖、不上服务器。TTY 无旗标时用勾选编辑（允许清空）；`--add` / `--remove` 增量修改；`--json` 或非交互无旗标时列出（展示名 + 规范 id）。本机交互式 `install` / `link` 成功提交（TTY 勾选或 Agent 带 `--tools` 重跑）中某工具被选中满 2 次会自动加入；脚本裸 `--tools` 与 `tools` 子命令本身不计次；取消勾选不会把它移出常用列表。

`esl tools sync [--global|-g]` —— 只修复 Tool Link Manifest 中**已记录**的 link：缺失或 ESL 自己的错链重建，被非 ESL 内容占用的目标报告冲突且不覆盖。它不按配置给未记录的技能批量新建 link，也不裁剪任何 link。

工具标识与目录：

| 工具 | 项目级 | 全局 |
|---|---|---|
| `claude`（输入别名 `claude-code`） | `.claude/skills/` | `~/.claude/skills/` |
| `codex` | `.codex/skills/` | `~/.codex/skills/` |
| `cursor` | `.cursor/skills/` | `~/.cursor/skills/` |
| `trae-intl` | `.trae/skills/` | `~/.trae/skills/` |
| `trae-cn` | `.trae/skills/` | `~/.trae-cn/skills/` |
| `workbuddy` | `.workbuddy/skills/` | `~/.workbuddy/skills/` |
| `opencode` | `.opencode/skills/` | `~/.config/opencode/skills/` |
| `openclaw` | `skills/` | `~/.openclaw/skills/` |
| `hermes` | `.hermes/skills/` | `~/.hermes/skills/` |

`trae` 是旧标识，不要在新命令中使用；规范标识是 `trae-intl`。

## 更新
`esl update [@scope/skill-name] [--global|-g]`

- `update` 只升级版本：已有正确 Tool Link 自动看到新内容，不复制、不重建。Skill Source Link 不被 registry 版本替换，输出为 linked (skipped)。
- `update` 不再接受 `--tools` / `--force`：选工具归 `install` / `link`，修链归 `esl tools sync`。更新目标存在 broken/conflict link 时报错，请先 `tools sync` 或处理冲突。
- 不指定技能名则更新当前作用域全部已装技能。
- 某项报 403 时，update 会跳过它继续更新其余技能并逐项报告失败原因；已安装源和其他工具 link 不受影响。

## 卸载
`esl uninstall @scope/skill-name [--global|-g]` —— 删除该作用域的技能源、依赖/锁/安装记录，以及该技能的全部 ESL 管理 link。普通安装删除 Store 副本；Skill Source Link 删除 Store 链接、记录和 staging，但保留本地源码目录。未管理内容不会被删除。

## 只解除部分工具 link
`esl tools remove @scope/skill-name --tools claude-code,cursor [--global|-g]`

- 只删除 manifest 记录的指定工具 link，保留 Skill Store 源。
- 目标已被替换成普通目录、文件或错误链接时报告冲突并保留记录。
- Trae 国际版与国内版在项目级共享同一物理 link；只移除其中一个工具时 link 保留给另一个工具，移除最后一个引用时才删除物理 link。
- 未传 `--tools` 时按交互 checkbox 选择；非交互环境或 `--no-input` 必须显式传 `--tools`。
- `claude-code` 是 Claude Code 的输入别名，CLI 会归一化为兼容标识 `claude`；已有 manifest、`.skills.json` 和工具目录不需要迁移。
