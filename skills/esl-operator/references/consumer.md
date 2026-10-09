# 消费者工作流：发现 / 试用 / 安装 / 管理

本页是命令参考。面向用户目标的整体流程见 `references/workflows.md`；执行前先选择任务阶段，再读取本页对应章节。

## 先判断来源与安装范围

- `@scope/name`：远端 Registry 技能。
- `@builtin/name`：随 CLI 发布的内置技能；不访问 Server，不需要登录或 Git。
- `./path`：本地技能源，安装身份固定为 `@local/<name>`，不可发布。
- 已安装技能：用 `esl skill list --json` 查看，不要把 Registry 详情当成本地状态。

安装前必须明确：当前项目还是全局、固定版本还是最新稳定版、目标 AI 工具、普通安装还是 Skill Source Link。不要把“装到我这里”默认解释成全局安装。

资源式命令面是 `esl skill …`（`search` `info` `install` `list` `update` `uninstall` `use` `share`）；高频动作保留顶层快捷入口，与资源路径行为等价：`esl search`、`esl info`、`esl install`、`esl list`、`esl update`、`esl uninstall`。文档优先使用资源路径。

只读命令可直接执行：`search`、`info`、`use`、`list --json`、`source validate`。写命令先回显完整命令、说明影响范围并等待用户确认：`install`、`link`、`unlink`、`update`、`uninstall`、`config preferred-tools`。

## 发现技能：搜索 → 详情 → 选择

`esl skill search [query] [--namespace <org>] [--keyword <text>] [--visibility public|private] [--limit <n>] [--json]`

它查询 ESL Server 上已发布且当前可安装的技能；不传 `query` 浏览全部可见技能。query 会匹配 identity、描述、显示名和 keywords。

Agent 必须使用 `--json`，再从结果中比较：

- 技能身份 `name`；
- 显示名 `displayName`；
- 描述与 keywords；
- `latestStableVersion`；
- `visibility`。

搜索后不要直接安装。必要时用 `esl skill info @scope/name --json` 复核版本、源码和发布信息，再向用户给出 1–3 个候选及选择理由。

**发现阶段完成标准**：用户选定明确的技能身份，并决定试用、安装或停止。没有结果时，说明查询词、namespace、可见性、登录态和 Server 可能造成的限制；不要擅自放宽过滤条件。

## 查看详情

`esl skill info @scope/skill-name [--json]`

始终查询 Registry：返回元数据、版本、源码信息和 display name。它不反映本机是否已安装；本地状态用 `esl skill list --json`。

- 未登录通常只能看到 public 技能。
- private 技能需要当前账号具备读取权限。
- `@builtin/*` 显示为 Built-in skill，不属于 Registry。

## 免安装试用

`esl skill use @scope/skill-name|./path [--version V]`

只把技能 Prompt 输出到 stdout，不写 Skill Store、不创建 Tool Link、不改项目。可以把远端技能试用理解为“阅读/验证 Prompt”，而不是安装或下载源码。

- 需要源码进行二次开发时使用 `esl source clone`，不要用 `skill use`。
- 试用阶段完成标准是用户确认技能行为符合目标；否则回到搜索或调整目标，不要为了完成流程而安装。

## 安装：确认范围 → 执行 → 验证

`esl skill install @scope/skill-name|./path [--version V] [--global|-g] [--tools all|工具列表] [--no-tools] [--force]`

### 执行前确认

1. 技能身份和版本；
2. 项目级还是全局级；
3. 目标工具，或明确 `--no-tools`；
4. 普通安装还是 Skill Source Link；
5. 是否接受发布依赖及其本地锁文件变化。

从 Server 安装远端技能通常需要 Server 和登录态；已发布技能通过 Registry/HTTP 获取，通常不要求本机安装 Git。源码 `clone`、`upload`、`publish` 等作者流程才需要 Git。安装 `@builtin/*` 只需要 CLI；本地 `./path` 需要有效源码目录，通常不需要登录。

- `@scope/name` 从 Server 安装最新或指定版本。
- `@builtin/*` 从 CLI 内置资源安装。
- `./path` 安装本地草稿，Store 身份固定为 `@local/<name>`，源目录不变。
- 安装会递归解析已发布依赖；失败时应保持整次安装不留半套图。
- 项目级状态写入项目 `.eslib/`、`.skills.json` 和 `.skills-lock.json`；全局状态写入用户 Store。`.eslib/` 应加入 gitignore。
- 选中的每个工具获得单技能 Tool Link；Tool Link 不等于安装本身。

安装是写操作：先展示完整命令，用户确认后执行。Agent 模式按 `agent-interaction.md` 处理工具选择；普通安装转换为 Skill Source Link（或反向）必须另行确认并使用 `--force`。

### 安装后验证

用 `esl skill list --json` 检查：技能身份、版本、作用域、安装模式、Tool Link 状态和依赖关系。必要时再用 `esl skill use` 或真实小案例验证行为。

完成报告至少包括：

- 技能和版本；
- 项目级/全局级；
- 安装模式；
- 目标工具及 Tool Link 状态；
- 验证命令和结果；
- 依赖是否一并安装。

## 列出与管理本机技能

`esl skill list --json`（或 `esl list --json`）是 Agent 的只读入口。TTY 下裸 `list` 会进入交互管理台；AI 不要用裸 `list`。

它用于确认本地 Store、直接依赖、锁定版本和 Tool Link。Registry 信息用 `info`，本地状态用 `list`，不要混淆。

## Tool Link 状态与修复

列表中的 Tool Link 状态可能包括：

- `linked`：正确指向 ESL Store 源；
- `broken`：Manifest 有记录但链接缺失或目标不存在；
- `conflict`：目标存在但不是预期 ESL 链接，不能覆盖；
- `source-only`：只安装到 Store，没有工具链接；
- `unmanaged`：工具目录中存在但不由 ESL 管理。

- 修复已记录链接：`esl skill update` 会在维护 Store 内容时修复缺失或 ESL 自己的错误链接，但不会覆盖 conflict，也不会凭偏好配置批量创建未记录链接。
- 调整目标工具：用 `esl skill install` / `esl link` 的 `--tools` 进行期望集合对账；涉及模式转换时先确认。
- `unmanaged` 内容不由 ESL 删除，不能把 `uninstall` 当作清理用户手工目录的命令。

## 常用工具偏好

`esl config preferred-tools [--add <tools>] [--remove <tools>] [--json]`

它只保存本机 TTY 的初始工具预选，不进入项目依赖、不上传服务器。显式 `--tools` 优先；非交互模式没有 `--tools` 时不能依赖该配置自动决策。修改偏好属于写配置，先确认。

规范工具标识：`claude-code`（兼容输入别名 `claude`）、`codex`、`cursor`、`trae-intl`、`trae-cn`、`workbuddy`、`opencode`、`openclaw`、`hermes`。新命令不要使用旧标识 `trae`。

## 更新：先看现状，再升级

`esl skill update [@scope/skill-name] [--global|-g]`

更新只升级已安装的 Registry 版本；Skill Source Link 不被 Registry 版本替换，会报告 linked/skipped。已记录的 Tool Link 会自动维护，冲突不会覆盖。

- 不指定技能名时，更新当前作用域全部技能。
- 新 Release 的依赖图会重新解析并回收不再需要的传递依赖。
- `update` 不接受 `--tools` / `--force`；调整工具使用 `install` / `link`。
- 403 项会跳过并逐项报告，其他技能不受影响。

更新是本地写操作：先确认技能、作用域和依赖变化；完成后再用 `list --json` 验证。

## 卸载：说明影响后再删除

`esl skill uninstall @scope/skill-name [--global|-g]`

删除指定作用域的 Store 技能、安装记录、锁文件关联和全部 ESL 管理 Tool Link。Skill Source Link 会删除 Store 链接和 staging，但保留本地源码目录；unmanaged 工具目录不会删除。

卸载前说明：

- 项目级还是全局级；
- 是否仍被其他根技能依赖；
- 哪些传递依赖会被回收；
- 哪些共享 Tool Link 会被移除。

卸载是本地删除操作：先展示完整命令和预期影响，用户确认后执行；失败时按 CLI 列出的依赖方先处理，不要加不存在的 `prune` 命令。

## 常见失败分流

| 症状 | 判断 | 下一步 |
|---|---|---|
| `esl` 找不到 | CLI 未安装或 PATH 未刷新 | 读取 `setup.md`，安装后新开终端复查 |
| 搜不到技能 | Server、查询词、可见性或权限限制 | 检查 Server；登录后复查；说明过滤条件 |
| 远端安装失败 | Server、登录、版本或依赖图问题 | 先读错误；不要把 Git 当成默认原因，只有错误明确涉及 Git 时再检查 |
| Tool Link `conflict` | 目标目录不是 ESL 管理链接 | 不覆盖；让用户手工处理冲突后重试 |
| 更新跳过 linked | 当前是源码开发链接 | 直接修改本地源码并 validate，不要反复 update |
| 卸载提示仍被依赖 | 其他根技能仍需要该依赖 | 先卸载/更新依赖它的根，或保留该技能 |
