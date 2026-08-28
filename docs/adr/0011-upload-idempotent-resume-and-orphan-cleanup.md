# Source Upload 对 Active Unreleased 源幂等续传，失败时补偿删除

Status: accepted

Source Upload 跨两个系统（ESL Server 的登记 + Git Backend 仓库）且客户端 git push 无法与服务器登记原子，原设计 fail-fast（skill 已存在即 409、本地已有 `esl` remote 即报错）让三种失败形态无法自愈：服务端建仓成功但 DB 写失败产生孤儿仓库；API 登记成功但客户端 push 失败形成「已登记未推送」且重跑被 409 + remote 已存在双死胡同（且无删除命令）；remote add 失败的重复尝试同样被「已存在」分支堵死。我们决定把 Source Upload 改为**可重试收敛**：同一创建者对 Active Unreleased Skill Source 的重传是续传而非冲突，任何一步失败后重跑同一命令都能收敛到同一终态，并对中途产生的孤儿仓库做 best-effort 补偿删除。

具体决策如下：

- **服务端 409 放宽为续传**：`POST /api/skills/upload` 遇到已存在 skill 时，若 `status` 为 `active-unreleased` 且 `createdBy` 为当前用户，返回 200 + 已存在的源（幂等续传），不再 409；已发布或由他人创建的源仍 409（与 CONTEXT 中「Source Upload 不用于覆盖已存在的服务器源码」一致——续传不覆盖源码，只是完成被打断的首次上传）。
- **服务端补偿删除**：`createOrganizationRepo → addRepositoryCollaborator → createServerSkill` 包进 try/catch，任何一步失败后 best-effort 调 `deleteRepo` 删掉已创建的孤儿仓库，使同名重传不再撞 Git Backend 的建仓冲突。为此 GiteaService 新增 `deleteRepo`（404 视为已删除）。
- **客户端 remote 已存在时校验续传**：`ensureEslRemote` 遇到 `esl` remote 已存在时，`git remote get-url esl` 校验其指向同一 cloneUrl——一致则继续 push（收敛），不一致才报错并给出 `git remote remove esl` 指引。
- **push 失败带恢复指引**：push 抛错时错误信息携带可执行恢复命令——「重跑 `esl upload` 或执行 `git push esl HEAD:main`」。由于不存在删除命令，恢复路径永远是「继续 push / 改名」，绝不指导「删了重来」。
- **不做「登记最后」的两段式重构**：`active-unreleased` 本身就是「已登记、尚未成功发布/推送」的中间态，模型已表达该语义；保持「登记先、代码后」的顺序，靠幂等重跑收敛，不引入新端点与新状态迁移。

## Considered Options

- **真原子事务**：本地 git 与远端服务器不可能有跨系统事务，放弃。
- **先 push 后登记（两段式 API）**：需要建仓 → push → 再登记的新端点与状态迁移，收益低（`active-unreleased` 已承担中间态），放弃。
- **fail-fast + 人工清理**：服务器没有 delete 命令，恢复通道不存在，放弃。

## Consequences

- `POST /api/skills/upload` 对同一创建者的 `active-unreleased` 源可返回 200（原为 409）；已发布或他人创建的源仍 409。
- GiteaService 新增 `deleteRepo`；上传中途失败的孤儿仓库被 best-effort 清理，删除本身失败只记日志不掩盖原始错误。
- 客户端 `ensureEslRemote` 语义从「报错」变为「校验 + 续传」；push 失败信息包含恢复命令。
- 服务器不区分「从未推送过的 active-unreleased」与「已成功推送但未发布」的源，续传对两者一视同仁——刻意接受：push 幂等，重复推相同内容无害。
