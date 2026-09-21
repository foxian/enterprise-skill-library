# Source Upload 成为 esl 化的源码提交+推送入口

Status: accepted

产品原则是「尽量让用户不碰原生 git，用 esl 命令完成源码协同」。`esl upload` 原本是一次性登记（ADR-0007/0010 语境下的首次 Source Upload），配合 ADR-0011 的续传、ADR-0012 的自动 git 前置后，我们把它正式演进为**esl 化的源码提交+推送入口**：首次含登记，之后含更新，用户全程不碰 `git add/commit/push`。冲突场景（多位维护者并发修改同一技能）由 esl 自动吞掉无冲突并发、把真冲突包装成清晰的 esl 指引。

具体决策如下：

- **已托管源跳过登记调用**：`esl upload` 先检查本地是否存在 `esl` remote——存在（已托管）则**不再调用登记 API**，直接进入同步；不存在才走首次登记/续传（ADR-0011 的 resume 仍在"remote 不存在但服务端有 active-unreleased 记录"的中断场景发挥作用）。已发布技能因此不再被 409 挡住，`esl upload` 可正常推送更新。
- **`--message` 作为提交说明**：`esl upload --message "..."` 的内容作为自动 commit 的 message（ADR-0012 引入的自动提交）；交互模式未传则提示填写（可选），留空用默认。说明存在 Gitea 的 git 历史里，不写数据库。
- **「已是最新」明确提示**：工作树干净且 `HEAD == esl/main`（fetch 后）时，报 `Source is already up to date`，不再误导性报 uploaded。
- **推前自动 rebase**：push 前 `git fetch esl`；本地落后时 `git rebase esl/main` 自动合并——无冲突静默通过，有冲突**保留 rebase 进行中状态**并明确提示「冲突文件已标出，解决后重跑 esl upload 完成合并并推送」。重跑时 `prepareSourceGit` 检测到 rebase 进行中则执行 `add -A` + `rebase --continue` 而非新建 commit，保留用户的 commit 与说明。绝不自动 abort 造成死循环。
- **身份漂移防护**：已托管路径校验 `SKILL.md` 短名与 `esl` remote 仓库短名一致，不一致报错并指引走 `esl rename`（防止把 A 技能内容推进 B 技能仓库）。
- **`esl status`**：显示本地 vs 服务器源状态——是否已托管、工作树干净/脏、领先/落后提交数、最近提交说明；已登录时 fetch 使 ahead/behind 准确。让 git-less 用户看得见状态。

## Considered Options

- **fail-fast + 手动 git 处理冲突**：冲突时 abort 并让用户手动解决。缺点：abort 后用户本地仍是旧基座，重跑 upload 会再次冲突，形成死循环——被弃。
- **冲突时保留 rebase 状态 + 重跑续接**（采纳）：解决冲突编辑 → 重跑 `esl upload` → `add -A` + `rebase --continue` → push。一条命令闭环，无 git 暴露。
- **完全不在 upload 里做同步**（保持纯 git push 更新）：与"不碰原生 git"原则冲突，被弃。

## Consequences

- `esl upload` 语义从"一次性登记"演进为"esl 化的提交+推送（首次含登记、已托管跳过登记）"；Source Update 可经 `esl upload` 完成，`git push esl main` 仍保留为底层通道。
- 已发布技能可直接 `esl upload --message "..."` 推送后续源码修改，不再 409。
- 真冲突仍需用户在编辑器解决（任何协同系统都不可避免）；esl 负责收窄到有语义冲突的文件并把流程包装成命令。
- 新增 `esl status` 命令；CONTEXT 的 Source Upload 定义随之更新。
