# 可恢复的跨系统开通工作流

Status: accepted

Tenant Organization Provisioning 以及其他同时写入 ESL 数据库和 Git Backend 的资源变更，不伪装为跨库原子事务；它们使用持久化状态机、幂等步骤、可观测失败原因和受控重试来达成最终一致性。申请接口先持久化并返回 `provisioning`，后台执行器负责推进，重启后继续处理；只有全部必需的 Git Backend 资源完成后才对用户宣布 `active`。可安全补偿的已创建资源在失败时清理，不能安全补偿或清理失败的资源保留状态供 ESL Platform Administrator 重试或人工修复。申请人的初始密码以短期应用级密文保存，开通成功或申请终止后删除。密码策略由部署参数统一驱动 ESL 与 Gitea，默认最小长度为 12。

## Consequences

组织名在 `pending`、`provisioning` 和 `failed` 状态期间持续占用；`rejected`、`cancelled` 或 `expired` 后才可释放。组织注册不再保存无业务用途的 `adminDisplayName`，管理员身份固定为 `admin`。

执行器使用 Provisioning Lease 防止并发推进；重试必须复用已验证的 Resource Provenance。纯 SQLite 变更仍使用本地数据库事务，Git Backend 操作则必须具备幂等查询、失败记录和恢复路径；这与 ADR-0011 的 Source Upload 续传和孤儿仓库补偿保持一致。

申请初始密码的密文使用独立的 `ESL_APPLICATION_ENCRYPTION_KEY`，由环境变量或 Docker Secret 注入；密钥缺失时禁止启用组织注册。Provisioning Lease 默认 60 秒，暂时性错误最多自动重试 5 次并采用指数退避，永久性错误转为 `failed`。Operation 记录只保存结构化、脱敏后的错误信息。

组织删除使用独立的异步生命周期：进入 `deleting` 后立即禁止登录、上传、发布和权限变更；失败进入 `delete_failed` 并由 ESL Platform Administrator 重试。平台数据库中的组织技能记录在 Git Backend 删除成功后清理，避免数据库先行删除造成残留资源无法追踪。

`pending` 申请默认保留 30 天，之后转为 `expired`；`failed` 不自动过期，`provisioning` 通过租约失效重新领取。`pending` 只能由 ESL Platform Administrator 取消，`active` 组织必须进入删除流程，所有取消、重试和删除操作写入审计记录。申请使用规范化组织名作为唯一业务键，审批使用 `applicationId + approve`，删除使用 `orgName + delete`；重复请求返回已有 Operation 状态。申请密码密文在开通成功、拒绝、取消或过期后立即删除，一次性密码只展示一次且不可恢复。
