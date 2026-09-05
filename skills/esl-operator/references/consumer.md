# 消费者工作流：找 / 装 / 用 / 更 / 卸 / 同步

只读命令（直接跑）：`search` `info` `use` `list`。
写命令（先回显、确认再跑）：`install` `update` `uninstall` `adapt`。

## 搜索
`esl search <query> [--json]` —— 在 ESL Server 搜可用技能。要取字段或比对时加 `--json`，你直接解析结构化数据。

## 查看详情
`esl info @scope/skill-name [--json]` —— 技能的元数据、版本、源码信息。已登录时请求会带上当前 Skill User Token：private 技能对其维护账号与有权限成员可见；未登录只能看到 public 技能。

## 免安装试用
`esl use @scope/skill-name|./path [--version V]` —— 把技能 Prompt 文本打到 stdout，不安装、不改项目。可管道：`esl use @scope/skill-name | <agent>`。

## 安装
`esl install @scope/skill-name|./path [--version V] [--global] [--no-adapt]`
- 从 Server 装最新或指定版本；`./path` 装本地草稿。来源由参数自动判断：`@scope/name` 走 Server、`@builtin/*` 走内置、`./path` 走本地路径——三者身份都确定，无需额外参数。
- 本地 `./path` 的安装身份固定为 `@local/<name>`（保留 Scope，不可发布）；安装时在 `.skills/` 里的**副本**补 `skill.json`，源目录不动。
- 默认装到当前项目 `.skills/`；`--global` 装到 `~/.skill-library/skills/`。
- 安装后会**自动跑 adapt** 把技能同步到 AI 工具目录。若用户只想要 `.skills/` 里的文件、不想刷到工具，用 `--no-adapt`。
- 跑完报告：装了什么、版本、adapt 到了哪些工具目录。
- 安装报 403（`Forbidden: read access required`）时：说明该 private 技能可能由**其他账号/组织**维护——各组织账号相互独立，当前登录看不到它。提议用户切回维护该技能的组织账号再装（`esl logout` 后用对应组织 `esl login`），不要盲目重试。

## 列出已装
`esl list` / `esl ls [--global] [--json]` —— 当前项目或全局已装清单。

## 手动同步到 AI 工具
`esl adapt [--global]` —— 把 `.skills/` 里的技能全量复制（零 symlink）到已配置工具目录。工具表：

| 工具 | 项目级 | 全局 |
|---|---|---|
| claude | `.claude/skills/` | `~/.claude/skills/` |
| trae | `.trae/skills/` | `~/.trae/skills/` |
| trae-cn | `.trae/skills/` | `~/.trae-cn/skills/` |
| codex | `.agents/skills/` | `~/.agents/skills/` |

当前项目要适配哪些工具，改 `.skills.json` 的 `tools` 数组（如 `["claude","trae","codex"]`）。

## 更新
`esl update [@scope/skill-name] [--global]` —— 升级到 Server 上的最新版本。不指定名字则更新全部。目标未装时先 `esl list` 确认。某项报 403 时（该技能可能由其他账号/组织维护），update 会跳过它继续更新其余技能并逐项报告失败原因——看到这种失败，提议用户切回维护它的组织账号再更新该项；已安装技能的本地副本与 adapt 产物不受影响，照常可用。

## 卸载
`esl uninstall @scope/skill-name [--global]` —— 移除技能，并清理 `.skills/`、依赖清单、各工具目录里的副本。
