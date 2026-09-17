# 消费者工作流：找 / 装 / 链 / 看 / 更 / 卸

只读命令（直接跑）：`search` `info` `use` `list` `tools list`。
写命令（先回显、确认再跑）：`install` `link` `unlink` `update` `uninstall` `adapt` `tools remove`。

## 搜索
`esl search <query> [--json]` —— 在 ESL Server 搜可用技能。要取字段或比对时加 `--json`，你直接解析结构化数据。

## 查看详情
`esl info @scope/skill-name [--json]` —— 技能的元数据、版本、源码信息。已登录时请求会带上当前 Skill User Token：private 技能对其维护账号与有权限成员可见；未登录只能看到 public 技能。

## 免安装试用
`esl use @scope/skill-name|./path [--version V]` —— 把技能 Prompt 文本打到 stdout，不安装、不改项目。可管道：`esl use @scope/skill-name | <agent>`。

## 安装
`esl install @scope/skill-name|./path [--version V] [--global] [--tools all|工具列表] [--no-tools] [--force]`

- 从 Server 装最新或指定版本；`./path` 装本地草稿。来源由参数自动判断：`@scope/name` 走 Server、`@builtin/*` 走内置、`./path` 走本地路径。
- 本地 `./path` 的安装身份固定为 `@local/<name>`（保留 Scope，不可发布）；安装时在 Store 副本里补 `skill.json`，源目录不动。
- 项目级技能源写入 `<project>/.eslib/skills/@<scope>/<skill>/`；全局级写入 `~/.eslib/skills/@<scope>/<skill>/`。
- 项目根 `.skills.json` 是直接依赖声明；`.skills-lock.json` 是完整依赖图和精确版本锁。`.eslib/` 是本机状态，应保持 gitignore。
- 每个被选工具得到单技能目录 link，link 名使用 `<scope>_<skill>`，指向 `.eslib` 中的 `@<scope>/<skill>` 源；不复制技能，也不链接整个工具 skills 根目录。
- `--tools all` 选择全部九个工具；`--tools claude,codex` 选择指定工具；`--no-tools` 只装源、不建 link；`--force` 只能替换 ESL 记录的异常 link，不能覆盖非 ESL 内容。
- 未传 `--tools` 时优先级是：项目 `.skills.json` 的 `tools` > 全局配置的 `tools` > 交互选择。非交互环境没有可用选择时，命令必须报错而不要等待输入。
- 重复安装是幂等的：正确 link 保持；缺少的补齐；冲突报告且不覆盖；未列出的已有工具 link 不删除。
- 部分工具发生冲突或 link 创建失败时，已经写入的源和其他成功 link 保留，但命令以失败状态结束并给出冲突详情。
- 安装报 403（`Forbidden: read access required`）时：说明该 private 技能可能由**其他账号/组织**维护。让用户切换到维护账号后重登，不要盲目重试。

## 本地源码开发链接

`esl link [./path] [--global] [--identity @namespace] [--tools all|工具列表] [--no-tools] [--force]`

- 把本地技能源码目录链入 Skill Store：Store 位置指向源码，已有 Tool Link 继续指向 Store，形成“工具目录 → Skill Store → 本地源码”的两层链路。
- 身份来自 `release.json`：完整 `@scope/name` 原样使用；裸短名默认 `@local/<name>`；`--identity` 只能补 namespace 或给出短名一致的完整身份。
- `link` 不读取、不写入、不生成源码目录里的 `skill.json`；link 元数据记录在安装状态中。
- Store 中已有普通安装副本时默认拒绝；`--force` 把原副本移入 `.eslib/link-staging/` 再指向源码。源码修改后，所有已链接工具立即看到。
- 同一源重复 link 是幂等的；换成另一个源必须 `--force`。

`esl unlink @scope/skill-name [--global]`

- 解除 Skill Source Link。有 staging 时纯本地恢复原副本和依赖/锁/安装状态；无 staging 时移除 link 和记录。
- staging 缺失或损坏时报错并保留 link 状态，不尝试联网恢复。

`esl uninstall` 对 link 技能只删除 Skill Store link、记录、Tool Link 和 staging，不会递归删除本地源码目录；`esl update` 会跳过 link 技能并报告 skipped。
`esl list` / `esl ls [--global] [--json]` —— 当前项目或全局 Skill Store 中已安装的技能。

## 查看工具 link
`esl tools list [--tool <列表>] [--skill <列表>] [--global|--project] [--managed|--unmanaged] [--status <状态列表>] [--json]`

- `linked`：link 存在且正确指向 Skill Store 源。
- `broken`：manifest 有记录，但 link 缺失或目标源不存在。
- `conflict`：目标存在，但不是预期的正确 ESL link。
- `source-only`：技能只在 Skill Store 中，没有工具 link。
- `unmanaged`：工具目录中存在，但不由 ESL manifest 管理。
- `--tool` 和 `--skill` 支持逗号分隔列表；`--status` 支持 `linked,broken,conflict,source-only,unmanaged`。
- 这个命令只读，直接运行；删除未管理内容仍必须由用户手工处理，ESL 不提供对应删除命令。

## 手动建立或检查 link
`esl adapt [--global]` —— 根据工具配置检查并建立已安装技能的 link。它只处理 Skill Store 中已安装的技能，遇到非 ESL 内容报告冲突。

工具标识与目录：

| 工具 | 项目级 | 全局 |
|---|---|---|
| `claude` | `.claude/skills/` | `~/.claude/skills/` |
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
`esl update [@scope/skill-name] [--global] [--tools <工具列表>] [--force]`

- 默认更新 Skill Store 中的源和锁文件；已有正确 link 自动看到新内容，不复制、不重建。Skill Source Link 不被 registry 版本替换，输出为 linked (skipped)。
- 默认不新增工具 link。传 `--tools` 时才确保指定工具存在正确 link。
- `--force` 只能替换 ESL 记录的旧 link；断链、错误链接或非 ESL 目录默认只报告。
- 不指定技能名则更新当前作用域全部已装技能。
- 某项报 403 时，update 会跳过它继续更新其余技能并逐项报告失败原因；已安装源和其他工具 link 不受影响。

## 卸载
`esl uninstall @scope/skill-name [--global]` —— 删除该作用域的技能源、依赖/锁/安装记录，以及该技能的全部 ESL 管理 link。普通安装删除 Store 副本；Skill Source Link 删除 Store 链接、记录和 staging，但保留本地源码目录。未管理内容不会被删除。

## 只解除部分工具 link
`esl tools remove @scope/skill-name --tools claude,cursor [--global]`

- 只删除 manifest 记录的指定工具 link，保留 Skill Store 源。
- 目标已被替换成普通目录、文件或错误链接时报告冲突并保留记录。
- Trae 国际版与国内版在项目级共享同一物理 link；只移除其中一个工具时 link 保留给另一个工具，移除最后一个引用时才删除物理 link。
