# 原地清除技能目录的 Git 与 ESL 身份痕迹

Status: accepted

跨实例播种应优先使用 `esl source export` 生成独立副本。仍有场景需要把**当前技能目录**还原成不含 Git 历史和 ESL 身份的纯技能文档/代码目录：删除 `.git` 与 `release.json`，保留 `SKILL.md` 与技能正文。

## 决策

- 提供 `esl source clean [path] [--force]`。这是本地破坏性写操作，不连接 Server，也不复制目录。
- 目录必须含 `SKILL.md`，避免误清普通 Git 仓库。删除 `.git/`、`release.json` 和 `release.json.before-reset`（若存在）；不删除 `.gitignore`、`scripts/`、`references/`、`assets/` 或技能正文。
- 非交互运行必须 `--force`。交互运行先确认。没有可删除痕迹时拒绝空操作。
- 这不是分发命令：要给另一家企业一份独立维护源，用 `source export`。`source reset` 仍只用于脱管（去掉 `esl` remote、备份清单，保留 Git 仓库）。`source clean` 会丢掉全部 Git 历史，不能当作 reset 的升级版。

## 不采用

- 扩展 `source reset`：reset 的语义是脱管后仍可继续作为 ESL 源目录维护。
- 默认删除 `.gitignore` 或未跟踪文件：那会误伤技能作者自己的忽略规则与草稿。
- 静默清理：破坏性过高，必须确认或 `--force`。
