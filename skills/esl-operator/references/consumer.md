# 消费者工作流：找 / 装 / 用 / 更 / 卸 / 同步

只读命令（直接跑）：`search` `info` `use` `list`。
写命令（先回显、确认再跑）：`install` `update` `uninstall` `adapt`。

## 搜索
`esl search <query> [--json]` —— 在 ESL Server 搜可用技能。要取字段或比对时加 `--json`，你直接解析结构化数据。

## 查看详情
`esl info @scope/skill-name [--json]` —— 技能的元数据、版本、源码信息。

## 免安装试用
`esl use @scope/skill-name|./path [--version V]` —— 把技能 Prompt 文本打到 stdout，不安装、不改项目。可管道：`esl use @scope/skill-name | <agent>`。

## 安装
`esl install @scope/skill-name|./path [--version V] [--global] [--no-adapt]`
- 从 Server 装最新或指定版本；`./path` 装本地草稿（缺 `skill.json` 会自动补全元数据）。
- 默认装到当前项目 `.skills/`；`--global` 装到 `~/.skill-library/skills/`。
- 安装后会**自动跑 adapt** 把技能同步到 AI 工具目录。若用户只想要 `.skills/` 里的文件、不想刷到工具，用 `--no-adapt`。
- 跑完报告：装了什么、版本、adapt 到了哪些工具目录。

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
`esl update [@scope/skill-name] [--global]` —— 升级到 Server 上的最新版本。不指定名字则更新全部。目标未装时先 `esl list` 确认。

## 卸载
`esl uninstall @scope/skill-name [--global]` —— 移除技能，并清理 `.skills/`、依赖清单、各工具目录里的副本。
