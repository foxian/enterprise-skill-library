# Changelog

本文件记录 **`@foxian/esl`（ESL CLI 发行包）** 的面向用户变更。格式参考
[Keep a Changelog](https://keepachangelog.com/)，版本号遵循 SemVer。发布流程见
[docs/guides/publishing-cli.md](docs/guides/publishing-cli.md)。

## [Unreleased]

### Changed

- **破坏性变更：CLI 收敛为资源式命令树（ADR-0059）。** 以 `esl skill`（`search|info|install|list|update|uninstall|use|share`）、`esl source`（`init|validate|status|upload|clone|reset|rename`）、`esl release`（`version|publish`、`depend add|remove|list`、`notes|deprecate|delete|repair-tag`）、`esl account`（`login|logout|whoami|change-password`）、`esl config`（`set-server|preferred-tools`）为主语，`esl link` / `esl unlink` 仍是唯一的 Source Link 顶层入口。永久顶层快捷入口 `search`、`info`、`install`、`list`、`update`、`uninstall`、`version`、`publish`、`login`、`logout`、`whoami` 与对应资源路径行为等价；`esl use` 不再有顶层入口。`skill info` 固定查 Registry，`skill list` 固定查本机 Skill Store，语义不随本地是否已安装而改变。旧顶层 `init`、`validate`、`status`、`upload`、`rename`、`reset-source`、`depend`、`notes`、`deprecate`、`release-delete`、`repair-tag`、`share`、`use` 与 `source`（克隆）改名到资源路径，不再保留隐藏、弃用或兼容别名。
- **Tool Link 降为安装的内部结果。** 删除公开的 `tools` 命令面（`tools list` / `tools sync` / `tools remove` / `tools preferred`）：工具 link 状态改由 `esl skill list` 展示，已记录 link 的修复并入 `esl skill update`，移除改用 `esl skill uninstall` / `esl unlink`；本机常用工具改为 `esl config preferred-tools`，且只影响 TTY 的初始工具预选，显式 `--tools` 优先。Tool Link Manifest 与期望集合对账规则保留。
- 站在 Local Skill Source 里做项目级 `esl link` / `esl unlink` 时只把「技能目录的上一级」当候选 Consumer Project Root，且只看一层（ADR-0057）：上一级已有 `.skills.json` 或 `.eslib/` 静默采用；只有 ESL 项目级工具点目录（`.claude` `.codex` `.cursor` `.trae` `.workbuddy` `.opencode` `.hermes`）时先确认（默认采用上一级，选否后可指定另一个目录或改为全局）；都没有则三选一（初始化上一级 / 指定目录 / 改全局），`--no-input` / 非交互在缺硬证据时失败并列出可行动选项。`esl link -g` 与在项目根的 `esl link ./path` 行为不变。`install` / `update` 站在无 Manifest/Store 的技能源码里写入前拒绝，避免建嵌套 Store；`list` / `uninstall` 不探测上一级，上一级有硬证据时只追加 Hint。
- `esl skill list`（及 `esl list` / `esl ls`）升级为当前 Skill Store 的本机交互管理入口（ADR-0058）：TTY 且未禁用输入时进入两级管理台（选技能 → 详情与动作），详情展示 Identity、version、source、安装时间、Store 内路径与逐条 Tool Link 状态，`source=link` 必显 Skill Source Link 源路径；确认后可执行单技能 `update`、期望 Tool Link 集合对账（语义同 install/link，ADR-0054，先展示将增/将删再确认）、`unlink` / `uninstall`（按 source 分流，builtin 等隐藏不适用动作）。`--json` / `--no-input` / 非 TTY 保持只读；`--json` 在 name/version/source 之上新增可选 displayName、tools（tool/status/managed）与 linkSourcePath，全部本机读取、不访问网络；人类只读输出每行附带已链接工具摘要。`list` 管理流第一版不接入 Agent Interaction，Agent 请 `list --json` 后改调专用写命令；Tool Link 的查看/修复/移除分别归 `esl skill list` / `esl skill update` / `esl skill uninstall`。

- 新增 `esl config preferred-tools`（原 `esl tools preferred`）：查看/编辑本机常用工具（`--add` / `--remove` / `--json`，TTY 无旗标时勾选编辑，允许清空）。常用工具只存本机客户端配置，且只影响 TTY 的初始工具预选；本机交互式 `esl skill install` / `esl link` 成功提交（TTY 勾选或 Agent 带 `--tools` 重跑）中某工具被选中满两次后自动加入，脚本裸 `--tools` 与 `config preferred-tools` 本身不计次。
- 非交互安装/链接不再回退本机 preferred tools：`esl skill install` / `esl link` 在非 TTY、`--no-input` 或脚本环境下缺显式 `--tools` 直接报错，Tool Link 目标绝不隐式选定（ADR-0059）。
- `esl skill install` / `esl link` 的 `--tools` 与交互勾选改为**期望 Tool Link 集合**语义（ADR-0054）：补齐集合内 link，删除集合外 ESL 管理项；空 `--tools` 被拒绝。TTY 交互每次弹勾选：预勾已有 link，首次工具挂载预勾本机常用工具并说明；覆盖安装与安装模式转换先确认。
- Agent Interaction（`--agent-interaction`）扩展到 `esl skill install` / `esl link`：只发出工具多选题（选项用展示名、提交规范 id），覆盖静默、模式转换无 `--force` 报错；用同一个 `--tools` 重跑完成。
- `esl skill update` 承接原 `esl adapt` / `esl tools sync` 的修复职责：只修复已记录的 Tool Link，不再按项目/全局工具配置给已装技能批量新建 link，也不裁剪任何 link。
- 项目 `.skills.json` 不再声明 AI 工具：读取时忽略遗留 `tools` 字段，写入时不再输出。
- `esl skill update` 移除 `--tools` 与 `--force`：升级版本后已有正确 Tool Link 自动看到新内容；损坏或冲突的 link 会报告，由 `esl skill update` 修复。
- 工具勾选与人类可读输出改用展示名（Claude Code、Trae International 等）；内部 id 与 CLI 参数不变。

### Fixed

- 新增包根 `postinstall.mjs` 入口：`dist/` 尚未构建（源码全新克隆）时跳过同步，避免 `npm install` 被 postinstall 阻断（ADR-0008）。

## [0.1.1] - 2026-09-28

### Added

- 发行包附带面向用户的英文 `README.md`（npm 包页）；中文说明在仓库 `docs/guides/cli-package-readme.zh-CN.md`（不打进 npm tarball）。

## [0.1.0] - 2026-09-28

### Added

- 首次公开发布到 npm：`@foxian/esl`（MIT）。
- 构建期捆绑客户端运行库（`@esl/core` / `@esl/i18n`）；不内置默认 ESL Server URL。
- `postinstall` 进入 `dist/`，安装后同步全局内置技能。
- Client-coupled 内置技能 `@builtin/esl-operator` 随 CLI 版本锁步发行。
