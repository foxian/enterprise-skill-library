# npm 式身份模型：Gitea 全局账号、扁平命名池与 release.json v3 权威 name

多租户「每 (组织, 用户) 一个 `<org>_<user>` Gitea 账号、组织间完全私有隔离、技能身份从 git remote 推导」的模型被废弃，改为 npm 式：Gitea 继续作为用户、组织、成员关系与团队的事实源，但账号无前缀、全局唯一；组织名与用户名共享一个扁平命名池（先到先得、保留名除外、一经占用不得改名）；技能归属由 Release Manifest v3 新增的必填 `name` 字段唯一声明（无 scope 即个人命名空间），首次 Source Upload 按它创建仓库并固定身份，`publish` 只断言未变。取代 ADR-0016、ADR-0022、ADR-0024、ADR-0026，并部分取代 ADR-0020（登录不再拼装组织前缀账号）。

## Considered Options

- **ESL 数据库接管身份（自建 users/memberships/teams 表），Gitea 降级为纯存储**：需要重写认证、权限与开通三大块；而 Gitea 原生就提供全局账号池、组织、Owners 团队、团队权限与仓库协作者——正是 npm 的形状，故弃。
- **release.json 另设 `namespace` 字段**：与 `name` 形成两个可互相打架的归属来源，弃；`name: "@scope/skill-name"` 单字段即身份（npm 同款）。
- **发布时按 `name` 自动迁移归属**：一次笔误即触发跨命名空间搬迁，把低频治理动作混进高频发布路径，弃；归属变更须走显式流程（v1 直接禁止跨命名空间移动）。
- **manual 模式保留异步 Operation 可恢复开通**：同步创建一个 Gitea org 没有跨系统一致性可言，Operation 机器在解决不存在的问题，弃；审批只是申请表上的状态翻转。

## Consequences

- 可见性与 Namespace 解耦：逐技能 `public`（平台全员可搜可装）/ `private`（默认，仅被授权者）；组织成员对组织内 private 技能默认零权限，授权载体为四个常设团队（只读 / 读写 / 技能管理 / 管理员，前三个随成员进出组织自动增删），组织管理员与技能 Maintainer 可切换可见性。
- 组织创建同步化：`org_registration_mode: auto` 即时创建，`manual` 申请审批后同步开通；申请提交时即查重（含同名待审申请），冲突不会到达审批环节。
- 废止项：single/multi 部署模式、默认组织、`<org>_admin` 账号、system-admins 团队、组织共享级别、Operation/Provisioning 全套机制、legacy `POST /api/skills` 路径；现有数据按 Bootstrap Reset 推倒重建，不做迁移。
- 登录不再携带组织字段（`username + password`）；用户注册（`registration_mode: open | approval`，默认 open）与拉人方式（邀请制 / 直接添加）为 Super Administrator 可配置的平台设置。
