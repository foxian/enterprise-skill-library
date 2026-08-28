# Source Upload 自动准备 Git 源码，一次命令完成

Status: accepted

`esl upload` 原本假设目录**已是** git 仓库且源码**已提交**：否则 `git remote add` / `git push` 直接失败（`fatal: not a git repository`、空 HEAD），而缺失 `release.json` 时还要"补清单 → 手动 commit → 重跑"两遍（ADR-0010）。对全新目录、被复制出来的技能目录或 monorepo 子目录体验很差。我们决定让 Source Upload **自动完成全部 git 前置**，一条命令从零传到服务器。

具体决策如下：

- **非 git 仓库自动 `git init`**：`git rev-parse --is-inside-work-tree` 失败或不在工作树时自动初始化。
- **缺失时自动写基础 `.gitignore`**：内容为 `.pytest_cache/`、`__pycache__/`、`*.pyc`、`node_modules/`、`.DS_Store`、`dist/`、`build/`、`.venv/`；已存在时**不覆盖**用户文件。自动提交依赖它挡住常见生成物垃圾。
- **有未提交改动时自动提交**：`git status --porcelain` 非空则 `git add -A` + `git commit -m "chore: commit skill source for esl upload"`；工作树干净则跳过。这是尽力而为——未被 `.gitignore` 覆盖的杂物会被一并提交，用户可用自己的 `.gitignore` 控制边界。
- **git 身份缺失时补仓库级默认值**：`user.name=esl upload`、`user.email=esl@local`，只在缺失时设置且只写仓库本地配置，不碰全局；避免干净环境上自动提交因缺身份失败。
- **缺失 `release.json` 不再两遍**：`ensureReleaseManifest` 落盘后直接进入自动提交流程（新清单被 commit），不再抛"先 commit + push 再重跑"。取代 ADR-0010 中 upload 侧的该行为；`publish` 保持原样。

## Considered Options

- **fail-fast + 手动前置**（现状）：把 git 职责留给用户，命令报错提示手动处理。缺点正是本决策要消除的体验断点。
- **自动提交放 flag 后**（`--commit`）：更保守，但"一条命令从零上传"的目标落空；自动提交本身是尽力而为且有 `.gitignore` 兜底，默认开启的收益大于风险。

## Consequences

- `esl upload` 现在可在全新目录/复制目录/未提交源码上直接成功；缺失 `release.json` 一次完成。
- 自动提交可能把未忽略的杂物纳入源码 commit；用户可通过预置 `.gitignore` 控制。
- ADR-0010 "补全 release.json 后提示先 commit + push、再重跑" 的 upload 侧行为被取代（`publish` 不变）。
- 服务端模型不变：Source Upload 仍是"一技能一源仓库"，`git push esl HEAD:main` 推送整个仓库。
