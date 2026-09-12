# 02 — `esl version` 重写为 Release Manifest bump

**What to build:** `esl version` 从「旧 skill.json 格式的 bump 命令」重定义为源码格式专用的版本递增命令（npm version 式）：改清单、提交、打 tag，一次完成版本与 commit 的绑定。

**Blocked by:** 01 — Release Manifest v2

**Status:** ready-for-agent

- [ ] `esl version major|minor|patch` 按 SemVer 递增 `release.json` 的 `version`。
- [ ] `esl version <显式 SemVer>` 直接设值，是旧 v1 清单的迁移入口。
- [ ] `version` 字段缺失且传入 bump 关键字时拒绝执行，报错指路显式设值。
- [ ] bump 后自动 `git commit`（提交信息可覆盖）并创建 annotated tag `v<SemVer>`。
- [ ] 命令**不 push**——推送仍归 `esl upload` / `esl publish`。
- [ ] 仓库脏工作树（非本命令改动的文件）时拒绝执行，避免把无关改动卷进 bump commit。
- [ ] 对 `@builtin/*` 身份拒绝执行（保持既有语义：内置技能版本随 CLI 发行）。
- [ ] 删除 `packages/core/src/version/version.ts` 的 `bumpSkillVersion` 与 `packages/cli/src/commands/version.ts` 的 skill.json 路径。
- [ ] 测试覆盖：三种 bump、显式设值、字段缺失报错、tag 创建、builtin 拒绝、脏树拒绝。
