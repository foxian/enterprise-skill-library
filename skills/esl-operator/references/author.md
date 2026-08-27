# 作者工作流：建 / 校验 / 发布 / 升版 / 拉源码

只读命令（直接跑）：`validate`。
写命令（先回显、确认再跑）：`init` `version` `source` `upload` `publish`。

## 初始化新技能
`esl init @ns/name [--license SPDX]` —— 在当前目录下生成技能文件夹（短名为目录名），含 `SKILL.md`（带 frontmatter）与 `release.json`。`release.json` 的 `schemaVersion` 为 `1`，`license` 默认 `MIT` 可用 `--license` 覆盖。**不生成 `skill.json`**——它是安装/发布包的生成物，不属于源码。

## 校验
`esl validate ./path` —— 发布前检查目录结构与 `SKILL.md` frontmatter。源码形态下，发布输入是 `SKILL.md` + `release.json`；`skill.json` 不在源码里，`validate` 不要求它。只读。校验失败把错误逐条对照修，别带 `--force` 跳过。

注意：`validate` 只校验结构，**不拦 `@local/*` 保留 Scope**——`@local` 的发布拦截由 `publish` 阶段执行。所以你在提议 `publish` 前要自己复核技能身份不是 `@local/*`，别等 `validate` 通过就以为能发。

## 上传源码（发布前必需）
`esl upload --directory ./path [--license SPDX]` —— 把本地源码目录首次创建为 Server-hosted Skill Source：生成 Skill ID 与服务器 Git 仓库，并把本地源码推上服务器（加 `esl` remote）。发布前必须已有 `esl` remote 且 `HEAD` 已推上去。新技能从 `init` 之后，先 `upload` 再 `publish`。

- 若目录缺 `release.json`，`upload` 会自动补最小清单（`schemaVersion: 1`，`license` 由用户显式确认或 `--license` 提供），并落盘到源码目录，然后提示先 commit + push、再重跑 `upload`。

## 发布
`esl publish [version] [--force|-f] [--license SPDX]` —— 在技能目录内执行，发布当前已推送且等于 `esl/main` 的 `HEAD` 为 Skill Release。要求目录含 `release.json`；若缺失会自动补最小清单（`schemaVersion: 1`，`license` 由用户显式确认或 `--license` 提供），落盘后**提示先 commit + push、再重跑 `publish`**（不会继续发布）。默认会先要你确认；`--force` 跳过确认；`--no-input` 在自动化里失败即止。

- 若目录还没有 `esl` remote，`publish` 会报错并提示你先 `esl upload`；它不自动建仓、不隐式 push。
- `publish` 只发布当前已推送的 HEAD，不自动推断或替你定发布身份。

重要：`@local/*` 保留 Scope 被系统拦截、无法发布。发布身份（scope 即其 Namespace）由 Platform Organization 锁定；短名由用户/团队提供——不要从登录用户名推断；用户没明确给你之前，先问，不要替它猜一个（猜错会落到错误组织下，之后改名要走正式 Skill Rename 流程）。跑完报告技能身份与 Release Tag（`v<SemVer>`）提示。

## 升级版本号
源码形态（`SKILL.md` + `release.json`）的技能不存储本地版本号——`esl version` 对它不可用（会提示改用 `publish`）。发新版直接指定 SemVer：`esl publish 0.2.0`（minor）/ `esl publish 0.2.1`（patch）/ `esl publish 1.0.0`（major）。版本号由 `publish` 固化到 Skill Release，源码中的 `release.json` 不记录 SemVer。`esl version` 仍只作用于含 `skill.json` 的安装副本或包形态目录。

## 拉别人源码做二次开发
`esl source @ns/name [./dir]` —— 克隆远端 Git 源码到本地（默认当前目录），可改可修。这拿的是源码仓库，不是 Published Package。
