# Changelog

本文件记录 **`@foxian/esl`（ESL CLI 发行包）** 的面向用户变更。格式参考
[Keep a Changelog](https://keepachangelog.com/)，版本号遵循 SemVer。发布流程见
[docs/guides/publishing-cli.md](docs/guides/publishing-cli.md)。

## [Unreleased]

## [0.1.1] - 2026-09-28

### Added

- 发行包附带面向用户的英文 `README.md`（npm 包页）；中文说明在仓库 `docs/guides/cli-package-readme.zh-CN.md`（不打进 npm tarball）。

## [0.1.0] - 2026-09-28

### Added

- 首次公开发布到 npm：`@foxian/esl`（MIT）。
- 构建期捆绑客户端运行库（`@esl/core` / `@esl/i18n`）；不内置默认 ESL Server URL。
- `postinstall` 进入 `dist/`，安装后同步全局内置技能。
- Client-coupled 内置技能 `@builtin/esl-operator` 随 CLI 版本锁步发行。
