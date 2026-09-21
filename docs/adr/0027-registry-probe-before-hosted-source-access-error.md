# Hosted Source 不可访问错误前先向 Registry 探测 Skill Identity

Status: accepted

ADR-0021 规定：已托管目录的 `git fetch esl` 失败一律按「凭据不足或源不可达」
处理，报统一的可行动错误。其前提是 Git Backend 对「无权限」与「不存在」返回
相同的 404，客户端无法区分。但 Git Backend 不可区分，不代表 Registry API
不可区分：`GET /api/skills/@scope/name` 在当前登录下可见与否，是一个独立且
可信的 oracle。我们决定：**同 origin 的 fetch 失败在报错前先做一次只读
identity 探测，按探测出的三种结果细分错误文案；行为不变——仍然绝不自动
接管、绝不重指。**

- **identity 在当前 server 可见且仓库路径与 remote 一致**：源存在、当前登录
  有读元数据权限，问题出在登录账号对 Git 仓库无写/读权限或凭据陈旧——
  指引「用维护它的账号重新登录后再 `esl upload`」。
- **identity 可见但 cloneUrl 与 remote 仓库路径不一致**：remote 指向陈旧
  的仓库路径（如 Rename 后旧路径已失效）——指引以服务器 cloneUrl 为准，
  不静默重指（同 origin 的路径修复不属 ADR-0023 的 origin 迁移语义）。
- **identity 在当前 server 不存在（404/不可读）**：源不在当前 server 上，
  可能已被 Deleted，也可能是同址的服务端数据重建（该两种在后端均已无痕，
  客户端不可也不需要进一步区分）——指引确认后 `git remote remove esl`
  重新登记。
- **探测本身失败（网络不可达、其他错误）**：退回 ADR-0021 的统一文案。

## Considered Options

- **保持纯 git 语义、不探测**：错误文案在「维护账号不对」与「源已删除」
  之间只能二选一地猜，用户会走错误的恢复路径。放弃。
- **探测成功即自动重指或自动重建 remote**：把只读诊断悄悄变成变更操作，
  违反 ADR-0021 的「绝不自动接管」。放弃。

## Consequences

- fetch 失败路径多一次带当前 token 的只读 HTTP 请求（仅同 origin 失败时）；
  异常时静默退回原错误文案，不新增失败面。
- ADR-0021 的「不自动接管」边界原样保留：所有探测结果都只改变文案，不
  改变任何 git 状态。
