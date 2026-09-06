# 部署模式与默认组织（实现 ADR-0022）

## Problem Statement

平台被固定为多组织形态：登录必填组织名、公开组织注册入口常开（ADR-0016 /
ADR-0020）。对企业自身自部署而言这些都是多余负担——单一组织内用 Organization
Team 即可完成协作划分，注册入口反而是多余的攻击面。企业希望部署成「单组织」：
只有一个组织可用、登录不必填组织名、没有注册入口；而技能云提供商仍需要多组织
的注册式多租户。两种形态应共存于同一平台，可由 Super Administrator 按部署场景
设置并随时双向切换。

## Solution

引入两个正交概念（详见 ADR-0022）：

- **部署模式（Deployment Mode）**：平台级开关，取值「单组织 / 多组织」。
  初始值由 Bootstrap 按部署场景声明，运行期由 Super Administrator 双向切换。
  单组织模式下，仅**默认组织**的成员可登录，其余组织整体冻结（组织自身状态
  不变，不可登录由模式推导，不新增组织级禁用状态字段）；冻结组织资产原样保留，
  切回多组织模式后恢复可用。
- **默认组织（Default Organization）**：独立于模式的配置。任何模式下都可设置，
  是登录省略组织名时的解析目标。多组织模式下可不设；单组织模式下必须设置且是
  唯一可登录的组织（Super Administrator 的管理后台登录不受此限）。模式切换时
  该设置保留。

## User Stories

1. As 技能云提供商（多组织部署），I want 平台默认处于多组织模式，so that 企业
   注册、审批、隔离的既有流程不受影响。
2. As 企业自部署方，I want 以单组织模式 Bootstrap、在环境变量中声明组织名与
   组织管理员初始凭据，so that 平台启动即就绪一个可用组织，无需走注册申请。
3. As Super Administrator，I want 从多个组织中指定一个为默认组织并把平台切换
   为单组织模式，so that 平台收敛为单组织形态。
4. As Super Administrator，I want 随时把平台从单组织切回多组织，so that 平台
   不会永久锁死在单组织形态。
5. As Super Administrator，I want 在多组织模式下也能设置默认组织，so that 成员
   登录可省略组织名（默认组织是可选配置，与模式正交）。
6. As Super Administrator，I want 模式切换时默认组织设置保留，so that 我不必
   每次切换后重新设置。
7. As 默认组织的成员，I want 登录时不必填写组织名，so that 登录更简单。
8. As 单组织模式下非默认（冻结）组织的成员，I want 我的登录与既有 token 均被
   拒绝，so that 平台只对默认组织可用，且我明白原因。
9. As 冻结组织的成员，I want 我的组织资产（技能、仓库、成员、团队）原样保留，
    so that 切回多组织后一切恢复可用。
10. As Super Administrator，I want 单组织模式下仍能登录管理后台，so that 我
    能管理平台、切换模式或重新指认默认组织。
11. As 注册申请人，I want 单组织模式下提交组织注册申请被服务端明确拒绝，so that
    我理解平台当前不接受新组织。
12. As Super Administrator，I want 切换到单组织时已有的待审批申请保持挂起，so
    that 我不损失这些申请。
13. As 注册申请人，I want 切回多组织后我的挂起申请继续按原流程处理，so that
    申请不会白交。
14. As CLI 用户（平台已设默认组织），I want `esl login` 跳过组织名提示，so that
    登录更快。
15. As CLI 用户（多组织且未设默认组织），I want `esl login` 仍要求填写组织名，
    so that 不存在跨组织歧义。
16. As CLI 用户，I want `--org` 显式指定可覆盖默认组织，so that 我能登录指定组织。
17. As Super Administrator，I want 单组织模式下仍可删除冻结组织，so that 我能
    清理不再需要的组织资产。
18. As Super Administrator，I want 删除默认组织被阻止，so that 平台永远不进入
    「除超级管理员外无人可登录」的死锁状态。
19. As Super Administrator，I want 单组织模式下更换默认组织时要求显式确认，so
    that 我理解这是整体换锁（原组织立即冻结、新组织立即可用）。
20. As Web 管理后台登录页，I want 平台设有默认组织时隐藏组织输入框，so that
    成员登录所见即所需。
21. As Web 注册页，I want 单组织模式下隐藏组织注册入口，so that 用户看不到
    不可用的路径（服务端仍硬拒绝）。
22. As 匿名客户端（CLI / Web），I want `GET /api/public/platform-info` 返回
    模式与默认组织名，so that 两端可在登录前自适应交互（组织名对匿名可见是
    接受的成本）。
23. As Super Administrator，I want 管理后台设置页提供模式切换与默认组织管理
    UI，so that 我不必调用 API。

## Implementation Decisions

- **持久化**：复用 `platform_settings` 键值表，新增键 `deployment_mode`
  （默认 `multi`）与 `default_org`（可空）。沿用 `org_registration_mode` 的
  读写与 seed 模式。
- **配置声明（Bootstrap 单组织变体）**：新增环境变量 `ESL_DEPLOYMENT_MODE`
  （`single` / `multi`，默认 `multi`）、单组织模式下必填的默认组织声明与组织
  管理员初始凭据。Bootstrap 读取声明后直接复用 `initializeTenantOrganization`
  （Tenant Organization Provisioning）创建组织并设为默认组织，触发源由「注册
  申请审批通过」变为「Bootstrap 声明」，不走注册申请。模式是初始值而非终身
  判决，部署后仍可双向切换。Bootstrap Reset（ADR-0018）流程不变，重置后按
  `.env` 声明的模式重新初始化。
- **匿名平台信息端点**：新增 `GET /api/public/platform-info`，返回
  `{ mode: 'single' | 'multi', defaultOrg: string | null }`，无需认证。CLI
  与 Web 登录/注册页在登录前消费它自适应交互。
- **登录契约变更**：`POST /api/auth/login` 与 `POST /api/console/login` 的
  `org` 字段在设有默认组织时（任何模式）变为可省略——服务端按默认组织拼装
  `<org>_<username>` 并校验归属，失败即失败，无跨组织歧义。`role` 判定与
  归属校验逻辑不变。Super Administrator 无组织登录行为不变。
- **单组织模式组织活跃性门禁**：在既有租户组织激活门禁（当前按请求体 `org`
  判断登录路线的 gate）基础上，单组织模式下对所有已认证请求额外校验调用者
  组织即默认组织。这同时覆盖新登录与既有 token——冻结组织成员 token 立即失效
  （逐请求校验，不等自然过期）。组织实体状态不新增字段。
- **注册硬拒绝**：`POST /api/orgs/apply` 在单组织模式下返回明确的模式特定
  错误；前端同步隐藏注册入口。切换时刻已存在的待审批申请保持挂起、不自动拒绝。
- **模式切换 API**：Super Administrator 管理端点支持
  `deployment_mode` / `default_org` 的读取与写入。切到单组织模式的请求必须同时
  携带默认组织名（原子切换：指定 + 切换）；切回多组织无需携带。默认组织保留。
- **默认组织守卫**：`DELETE /api/admin/orgs/:orgName` 在目标为默认组织时阻止，
  要求先更换默认组织或先切回多组织模式。单组织模式下更换默认组织允许但要求
  显式确认（沿用删除的 `confirm` 交互形态）。
- **Web UI**：登录页在平台设有默认组织时隐藏组织输入框；注册页在单组织模式
  隐藏注册入口并展示原因；超级管理员设置页新增部署模式切换与默认组织选择器
  （含换锁确认）。
- **CLI 登录流程**：`esl login` 先查 `platform-info`，有默认组织则跳过组织名
  提示，无默认组织才要求填写；`--org` 显式指定始终可覆盖默认组织；`--no-input`
  场景按解析出的默认组织补齐。

## Testing Decisions

**好的测试只验证外部行为**：登录契约（org 可省略与按默认组织解析）、模式门禁
（冻结组织被拒、token 立即失效）、平台信息端点的内容、注册拒绝、模式切换的
原子性、删除守卫——不测试内部状态字段如何落库。

三个缝，全部复用既有缝：

- **缝 1（主缝，服务端 HTTP 面）**：`buildApp()` + mock GiteaService + 临时
  SQLite + `app.inject()`。覆盖：登录 org 可省略（单/多两种模式）、
  `platform-info` 匿名返回、单组织模式注册申请拒绝、挂起申请跨切换保持、模式
  切换 API（含切单必须带默认组织）、默认组织读写、删除默认组织被守卫、冻结组织
  成员 token 调技能路由被拒（立即失效）、单组织模式下超级管理员 console 登录
  可用。先例：`org-admin.test.ts`、`org-lifecycle.test.ts`。
- **缝 2（Web 视图）**：`@vue/test-utils` mount + `setFetchImpl()`。覆盖：登录
  页组织输入框按 `platform-info` 条件隐藏、注册入口单组织隐藏、设置页模式切换
  与默认组织管理 UI（含换锁确认）。先例：`login.test.ts`、`super-console.test.ts`。
- **缝 3（CLI login）**：注入 fetch / readInput 的函数级单测。覆盖：先查
  `platform-info`、有默认组织跳过提示、无默认组织仍要求填写、`--org` 覆盖。
  先例：`packages/cli/tests/login.test.ts`、`login-multi-org.test.ts`。

**配置解析**：新增环境变量的解析与默认值走 `config.test.ts` 既有低缝；
Bootstrap 声明触发 Provisioning 复用的 `initializeTenantOrganization` 已被
`org-lifecycle.test.ts` 覆盖，启动接线由 docker 冒烟验证而非单测。

## Out of Scope

- 多组织模式的既有行为变更（组织隔离、RBAC、注册审批流均不变）。
- Tenant Organization Provisioning 内部实现（已覆盖）。
- 注册流程的 UX 重设计。
- 自动模式切换触发（如「删到只剩一个组织就自动切单组织」）——不纳入。
- 除组织活跃性之外的 token 过期策略。
- SSO / 外部身份提供方接入。

## Further Notes

- 术语沿用 ADR-0022 与 `CONTEXT.md`：**默认组织**而非「唯一组织」（它在多组织
  模式下是 fallback，单组织模式下才附带唯一活跃效果）；冻结由模式推导、不落库。
- 与 ADR-0020 的衔接：`/api/console/login` 的 org 可选性原本只为超级管理员
  留空而存在，本次扩展为「默认组织成员也可留空」，归属校验与角色判定逻辑不变。
- 登录省略组织名时若账号不属于默认组织，返回与 ADR-0020 一致的凭据失败语义，
  不额外暴露信息。
