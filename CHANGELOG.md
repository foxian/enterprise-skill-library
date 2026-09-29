# Changelog

本文件记录 **`@foxian/esl`（ESL CLI 发行包）** 的面向用户变更。格式参考
[Keep a Changelog](https://keepachangelog.com/)，版本号遵循 SemVer。发布流程见
[docs/guides/publishing-cli.md](docs/guides/publishing-cli.md)。

## [Unreleased]

### Changed

- 新增 `esl tools preferred`：查看/编辑本机常用工具（`--add` / `--remove` / `--json`，TTY 无旗标时勾选编辑，允许清空）。常用工具只存本机客户端配置；本机交互式 `install` / `link` 成功提交（TTY 勾选或 Agent 带 `--tools` 重跑）中某工具被选中满两次后自动加入，脚本裸 `--tools` 与 `tools` 子命令不计次。
- `install` / `link` 的 `--tools` 与交互勾选改为**期望 Tool Link 集合**语义（ADR-0054）：补齐集合内 link，删除集合外 ESL 管理项；空 `--tools` 被拒绝。TTY 交互每次弹勾选：预勾已有 link，首次工具挂载预勾本机常用工具并说明；覆盖安装与安装模式转换先确认。
- Agent Interaction（`--agent-interaction`）扩展到 `install` / `link`：只发出工具多选题（选项用展示名、提交规范 id），覆盖静默、模式转换无 `--force` 报错；用同一个 `--tools` 重跑完成。
- `esl tools sync` 取代 `esl adapt`：只修复已记录的 Tool Link，不再按项目/全局工具配置给已装技能批量新建 link，也不裁剪任何 link。
- 项目 `.skills.json` 不再声明 AI 工具：读取时忽略遗留 `tools` 字段，写入时不再输出。
- `esl update` 移除 `--tools` 与 `--force`：升级版本后已有正确 Tool Link 自动看到新内容；损坏或冲突的 link 会报告，请用 `esl tools sync` 修复。
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
