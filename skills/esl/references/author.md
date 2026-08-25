# 作者工作流：建 / 校验 / 发布 / 升版 / 拉源码

只读命令（直接跑）：`validate`。
写命令（先回显、确认再跑）：`init` `version` `source` `publish`。

## 初始化新技能
`esl init @ns/name` —— 在当前目录下生成技能文件夹（短名为目录名），含 `SKILL.md`（带 frontmatter）、`skill.json`、`scripts/` `references/` `assets/`。`skill.json` 的 `name` 用全名 `@ns/name`，`SKILL.md` 的 `name` 用短名，两者必须一致。

## 校验
`esl validate ./path` —— 发布前检查目录结构、`SKILL.md` frontmatter、`skill.json` 元数据是否合法。只读。校验失败把错误逐条对照修，别带 `--force` 跳过。

注意：`validate` 只校验结构，**不拦 `@local/*` 命名空间**——`@local` 的发布拦截由 `publish` 阶段执行。所以你在提议 `publish` 前要自己复核 `skill.json` 的 `name` 不是 `@local/*`，别等 `validate` 通过就以为能发。

## 发布
`esl publish [--force|-f]` —— 在技能目录内执行；发布到 ESL Server，由 Server 管理内部 Git backend。默认会先要你确认；`--force` 跳过确认；`--no-input` 在自动化里失败即止。

重要：`@local/*` 命名空间被系统拦截、无法发布。发布前复核 `skill.json` 的 `name` 是合法团队命名空间（非 `@local`），并把 `validate` 跑过。命名空间是技能的稳定身份，由用户/团队提供——不要从登录用户名推断；用户没明确给你之前，先问，不要替它猜一个（猜错会落到错误组织下，之后改名要走正式 Skill Rename 流程）。跑完报告技能身份与 Release Tag（`v<SemVer>`）提示。

## 升级版本号
`esl version minor|patch|major` —— 按 SemVer 升：`0.1.0 → 0.2.0`（minor）/ `→ 0.2.1`（patch）/ `→ 1.0.0`（major）。

## 拉别人源码做二次开发
`esl source @ns/name [./dir]` —— 克隆远端 Git 源码到本地（默认当前目录），可改可修。这拿的是源码仓库，不是 Published Package。
