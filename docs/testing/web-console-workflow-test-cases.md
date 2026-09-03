# ESL 管理后台（Web Console）工作流测试用例（Issue #15–#22）

## 概述

本文档为 ESL 管理后台（Web Console）针对 **跨系统一致性工作流** 批次的功能测试用例，供浏览器自动化逐步执行。它是 [web-console-e2e-test-cases.md](./web-console-e2e-test-cases.md)（45 条已执行基线，覆盖 Issue #3–#14）的**续篇**：用例编号延续基线编号，覆盖 2026-09-02 关闭的 GitHub Issue **#15–#22**。

- **Issue 对照**：
  - #15 统一账号规则与跨系统最终一致性工作流（父规格）
  - #16 统一 Skill User Password Policy 与账号命名校验
  - #17 可恢复 Operation、租约与审计基础设施
  - #18 Tenant Organization Provisioning 状态机
  - #19 成员生命周期的一致性工作流
  - #20 Tenant Organization 删除工作流
  - #21 组织状态接入访问控制与 Web Console
  - #22 技能创建、上传、发布和权限同步接入 Operation
- **测试对象**：Web Console 三类角色 —— Super Administrator（`/admin/super/`）、Organization Admin（`/admin/org/`）、Member（`/admin/member/`），以及部分 API 级断言。
- **测试层级**：浏览器 E2E + API 级断言；`failed`/`delete_failed`/`provisioning` 等无法自然触发的中间与失败状态通过 **DB 种子** 构造（见「DB 种子工具」）。
- **测试目的**：验证 Provisioning 状态机、成员生命周期、组织删除工作流、组织状态访问控制、统一密码/命名策略，以及 Operation 重试/幂等/审计在 Web Console 的可观测行为。
- **相关代码**：
  - 前端视图：[packages/web/src/views/](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/)（尤其 [RegisterView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/RegisterView.vue)、[super/ApplicationsView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/super/ApplicationsView.vue)、[super/OrgsView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/super/OrgsView.vue)、[super/OrgDetailView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/super/OrgDetailView.vue)、[org/MembersView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/org/MembersView.vue)）
  - 前端状态文案：[packages/web/src/constants/org-status.ts](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/constants/org-status.ts)
  - 服务端路由：[packages/server/src/routes/](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/)（`orgs.ts`、`org-admin.ts`、`org-console.ts`、`auth.ts`）与 [app.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/app.ts) 的访问控制 preHandler
  - 领域决策：[ADR-0017](file:///d:/DevProjects/enterprise-skill-library/docs/adr/0017-recoverable-cross-system-provisioning.md)
- **对既有基线用例的影响**（执行本批用例前应知悉，避免误判回归）：
  | 基线用例 | 行为变化 |
  | --- | --- |
  | AUTH-06 免审批注册 | 不再返回「组织已开通」，改为返回 `provisioning`「组织正在开通」（本文档 AUTH-15 取代其新断言） |
  | AUTH-07 需审批注册 | 仍返回 `pending`，注册结果文案不变；新增申请人自助查询入口 |
  | SUPER-07 批准申请 | 新申请批准后进入后台开通（返回 `provisioning`），不再由超管生成一次性密码；一次性密码仅存在于兼容旧申请路径（本文档 SUPER-16） |
  | ORG-02/03/04 添加成员/重置密码 | 响应升级为 `202 { status, operationId }`，成员创建为可恢复 Operation，UI 展示一次、行为兼容 |
  | ORG-05/06 禁用/启用成员 | 变为可恢复 Operation，部分失败可重试，不再静默成功 |

## 术语表

| 术语 | 说明 |
| --- | --- |
| Operation | 跨 ESL SQLite 与 Gitea 的可恢复执行单元：记录操作类型、目标资源、幂等键、状态、当前步骤、租约、重试次数与脱敏失败原因（ADR-0017）。 |
| 幂等键（Idempotency Key） | Operation 的唯一约束键。重复请求命中已有键时返回既有 Operation 状态，不重复执行外部副作用。组织申请=规范化组织名；审批=`applicationId + approve`；删除=`orgName + delete`；成员/技能/权限由服务端生成。 |
| 租约（Lease） | 执行器领取任务的持有凭证，默认 60 秒；租约过期可被重新领取，服务重启后可恢复未完成任务。 |
| Provisioning 状态机 | 组织申请生命周期：`pending`、`provisioning`、`active`、`failed`、`rejected`、`cancelled`、`expired`。`active`/`rejected`/`cancelled`/`expired` 为终态；重试仅允许 `failed → provisioning`。 |
| 删除工作流 | 组织删除生命周期：`deleting`、`delete_failed`、`deleted`。进入删除状态后立即禁止登录与业务操作。 |
| Resource Provenance | 资源归属证明。仅 ESL 开通并登记的资源才允许自动删除；发现外部/未登记资源时停止自动清理并记录失败原因。 |
| Skill User Password Policy | 部署参数驱动的统一密码策略，ESL 与 Gitea 共用同一最小长度（默认 12）；前端、服务端、核心包复用同一规则，Gitea 保留最终校验权。 |
| 一次性密码 | 仅在创建/重置时展示一次（自动生成场景），关闭后不再可见；列表、接口与日志不泄露密码相关材料。 |

## 测试环境与前置准备

1. Docker 栈已运行：`docker compose ps` 应显示 `api`（healthy）、`gitea`、`server` 均 Up；`server` 暴露 `0.0.0.0:3000`。
2. 前端为最新构建产物：宿主机执行 `npm run build --workspace @esl/web`，随后 `docker compose up -d server` 重新部署。
3. 平台已完成 Bootstrap，存在超管账号与 Gitea 后端。
4. 平台必须配置 `ESL_APPLICATION_ENCRYPTION_KEY`（`.env` / Docker Secret）；未配置时注册接口返回 503（本期不作为常规用例，见 NEG 提示）。
5. 密码最小长度默认 12（`ESL_PASSWORD_MIN_LENGTH`），与 Gitea `MIN_PASSWORD_LENGTH` 一致。

### DB 种子工具

`failed`/`delete_failed`/`deleting` 等状态无法通过真实流程自然触发，通过直接修改 SQLite（宿主路径 `${ESL_DATA_DIR:-./data}/api/esl.db`，容器内 `/data/esl.db`）构造前置数据。api 容器已内置 `better-sqlite3`：

```bash
# 查看当前租户状态（Git Bash / WSL 或容器内执行）
docker compose exec api node -e 'const db=require("better-sqlite3")("/data/esl.db"); console.log(db.prepare("SELECT org_name,status,operation_id FROM tenant_organizations").all());'
```

> Windows PowerShell 直接执行 `node -e '...'` 时单引号不会被当作引号；可将脚本保存为 `seed.cjs` 后用 `docker compose cp` 拷入容器执行，或改用 Git Bash / WSL。示例脚本见下方各用例的「DB 种子」步骤。

### 账号清单

与基线文档一致：

| 角色 | 登录用户名 | 组织名（登录表单） | 密码来源 |
| --- | --- | --- | --- |
| 超级管理员 | `eslroot` | 留空 | `.env` 中 `GITEA_ADMIN_PASSWORD` |
| 组织管理员 | `admin` | `<org>` | 注册时提交的初始密码（自动模式即开通密码） |
| 普通成员 | `<membername>` | `<org>` | 添加/重置时指定或一次性生成 |

> 账号命名约定：Gitea 用户名 = `<org>_<username>`；无组织前缀推导为超级管理员，组织内 `admin` 推导为组织管理员，其余为成员。管理员本地身份固定为 `admin`，底层用户名为 `<org>_admin`。

### 测试数据命名与隔离策略

- 组织：`wf<YYYYMMDDHHmmss>`（如 `wf20260903100000`）。
- 成员：`mem<ts>`；种子组织：`seedfail<ts>`、`seeddel<ts>`。
- **DB 种子**均只作用于本用例自建或临时翻转状态的数据，用例结束恢复原状（`active`）或删除。
- 破坏性用例（禁用成员、删除组织）排在分组末尾，只作用于本用例自建数据。
- 每条用例执行前清理浏览器会话（清除 `localStorage` 中 `esl-admin-session`），避免残留登录态。

### 用例编号与优先级

- 编号前缀沿用基线：`AUTH-`、`SUPER-`、`ORG-`、`E2E-`、`NEG-`，从基线末尾续号（AUTH-12、SUPER-11、ORG-15、E2E-02、NEG-07 起）。
- 优先级：`P0` 核心主流程（阻断性），`P1` 主要功能，`P2` 边界与次要。
- 每条用例标注关联 Issue 与状态构造方式（真实流程 / DB 种子 / API）。

---

## A. 注册与 Provisioning 状态机（AUTH-12 ~ AUTH-18）

### AUTH-12　注册页组织名规则前端校验（P1）　关联 #16

- **前置条件**：访问 `/admin/register`。
- **测试数据**：`orgName` 依次填 `BadName`（含大写）、`-ab`（首连字符）、`ab-`（尾连字符）、`ab c`（空格）、40 位小写字符串（超长）、保留字。
- **操作步骤**：
  1. 逐项输入组织名，观察 `data-test="org-name-error"`。
  2. 每次输入后直接点击提交。
- **预期结果**：
  1. 非法输入即时展示错误文案（`org-name-error`），提交被前端拦截，不发出 `POST /api/orgs/apply`（网络面板无请求）。
  2. 合法名（2-39 位小写字母/数字/连字符）不展示错误。
- **验证口径**：浏览器 Network 面板确认非法输入时无 apply 请求。

### AUTH-13　注册页密码最小长度前端校验（P1）　关联 #16

- **前置条件**：访问 `/admin/register`。
- **测试数据**：`password` 填 11 位密码、`confirmPassword` 相同。
- **操作步骤**：填写后提交。
- **预期结果**：
  1. 前端 `data-test="register-error"` 提示密码规则错误（最小长度 12），不提交。
  2. 改为 12 位及以上密码后可通过，进入后续服务端校验。
- **验证口径**：Network 面板确认短密码无 apply 请求。

### AUTH-14　注册页管理员账号固定 admin 与登录账号预览（P1）　关联 #16

- **前置条件**：访问 `/admin/register`。
- **测试数据**：`orgName=wf<ts>`。
- **操作步骤**：输入组织名后观察页面。
- **预期结果**：
  1. `data-test="admin-account"` 输入框值为 `admin` 且为只读（disabled）。
  2. `data-test="admin-account-preview"` 显示 `登录账号：wf<ts>_admin`；组织名为空时显示 `组织名_admin`。

### AUTH-15　自动模式注册返回 provisioning（P0）　关联 #18、#21　（真实流程，取代 AUTH-06 新断言）

- **前置条件**：注册模式为 `auto`（默认；若不确定先按 SUPER-10 查看/恢复）。
- **测试数据**：`orgName=wf<ts>`、`password/confirmPassword=<12 位以上密码>`。
- **操作步骤**：
  1. 注册页填写并提交（`data-test="register-submit"`）。
  2. 观察注册结果区 `data-test="register-result"`。
  3. 等待后台执行器完成（数秒），用 `username=admin`、`org=wf<ts>`、刚才的密码登录。
- **预期结果**：
  1. `POST /api/orgs/apply` 返回 `201 { status: "provisioning", operationId }`（**不再返回 approved/“已开通”**）。
  2. `register-result` 标题为「组织正在开通」，副标题为「组织资源正在后台初始化，完成后即可登录。」。
  3. 执行器完成后该组织进入 `active`，用注册密码可登录进入 `/admin/org/members`。
- **清理**：登录超管后执行 SUPER-14 删除该组织，或保留作为种子数据。

### AUTH-16　手动模式注册返回 pending（P0）　关联 #18　（真实流程，取代 AUTH-07 新断言）

- **前置条件**：超管已把注册模式切为 `manual`（SUPER-10）。
- **测试数据**：`orgName=wf<ts>`、`password=<12 位以上密码>`。
- **操作步骤**：
  1. 注册页提交。
  2. 观察 `register-result`。
- **预期结果**：
  1. `POST /api/orgs/apply` 返回 `201 { status: "pending", applicationId }`。
  2. `register-result` 标题为「申请已提交，等待审批」，副标题「平台管理员审批通过后，组织将进入后台开通流程。」。
- **清理**：结束前由超管把注册模式恢复为 `auto`（默认），避免污染后续用例。

### AUTH-17　申请人自助查询申请状态（仅查看，无重试/取消入口）（P1）　关联 #21　（真实流程）

- **前置条件**：存在 `pending`（手动模式）或 `provisioning`/`active`（自动模式）的申请 `wf<ts>`，申请人密码已知。
- **操作步骤**：
  1. 注册页「查询申请状态」区输入 `data-test="status-org-name"` 与 `data-test="status-password"`（申请时初始密码）。
  2. 点击 `data-test="status-query"`。
- **预期结果**：
  1. `POST /api/orgs/applications/{orgName}/status` 返回 `{ orgName, status }`，`data-test="status-result"` 显示「组织 xxx 的申请状态：待审批/开通中/已激活」。
  2. 页面**没有任何**重试、取消、修复入口（申请人无权操作）。
- **验证口径**：响应体不包含密码、密文或 Token 字段。

### AUTH-18　申请人查询状态密码错误被拒（P1）　关联 #21　（真实流程）

- **前置条件**：同 AUTH-17，存在含申请密文的 `pending` 申请。
- **测试数据**：正确组织名 + 错误密码。
- **操作步骤**：查询。
- **预期结果**：
  1. 接口返回 `403`（`Applicant password does not match`），`status-result` 展示该错误文案。
  2. 不泄露申请状态或任何凭据材料。
- **验证口径**：`status-result` 仅含错误信息，不含状态值。

---

## B. 超管控制台：组织状态、审批、重试与删除工作流（SUPER-11 ~ SUPER-18）

### SUPER-11　组织列表生命周期状态展示（P0）　关联 #21　（DB 种子）

- **前置条件**：超管已登录；用 DB 种子创建不同状态的组织。
- **DB 种子**：对正常开通的组织 `wf<ts>` 在 `tenant_organizations` 中临时翻转状态：
  ```bash
  # 备份原状态后分别置为 provisioning / failed / deleting / delete_failed（测完恢复 active）
  docker compose exec api node -e 'const db=require("better-sqlite3")("/data/esl.db"); db.prepare("UPDATE tenant_organizations SET status=? WHERE org_name=?").run("failed", "wf20260903100000");'
  ```
- **操作步骤**：进入 `/admin/super/orgs`，观察 `data-test="orgs-table"`。
- **预期结果**：
  1. `data-test="org-status-{name}"` 标签文案与配色正确：已激活（success）、开通中（warning）、开通失败（danger）、删除中（warning）、删除失败（danger）。
  2. 开通失败的组织即使未出现在 Gitea（无 Git Backend 组织），也会因租户表补充出现在列表中（`/api/admin/orgs` 兜底）。
- **清理**：恢复所有种子组织状态为 `active`。

### SUPER-12　组织详情失败原因展示与重试入口（P0）　关联 #17、#21　（DB 种子）

- **前置条件**：种子组织 `seedfail<ts>` 状态为 `failed`，`tenant_organizations.last_error_json` 写入脱敏错误。
- **DB 种子**：
  ```bash
  docker compose exec api node -e 'const db=require("better-sqlite3")("/data/esl.db"); db.prepare("UPDATE tenant_organizations SET status=?, last_error_json=? WHERE org_name=?").run("failed", JSON.stringify({code:"org.provision.failed", message:"Gitea user creation failed (simulated)", details:{}}), "seedfail20260903100000");'
  ```
- **操作步骤**：进入 `/admin/super/orgs` → 点击 `data-test="org-detail-{name}"` 进入详情页。
- **预期结果**：
  1. `data-test="org-status"` 显示「开通失败」。
  2. `data-test="org-last-error"` 展示错误码与脱敏失败原因，不包含密码/密文/Token。
  3. `data-test="retry-operation"` 按钮仅对 `failed`/`delete_failed` 状态显示；`active` 组织不显示。
- **清理**：删除种子组织（SUPER-14/15）。

### SUPER-13　重试失败开通（failed → provisioning → active）（P0）　关联 #17、#18　（DB 种子）

- **前置条件**：种子组织 `seedfail<ts>` 状态 `failed`，关联一个 `failed` 的 `organization.provision` Operation（payload 含 `orgName`、`applicationId`；Gitea 侧资源可部分存在）。
- **DB 种子**：
  ```bash
  docker compose exec api node -e 'const db=require("better-sqlite3")("/data/esl.db"); const op=db.prepare("INSERT INTO operations (idempotency_key, kind, status, payload_json, attempts, max_attempts) VALUES (?,?,?,?,?,?)").run("seed.provision:"+Date.now(), "organization.provision", "failed", JSON.stringify({orgName:"seedfail20260903100000", applicationId:1}), 3, 5); db.prepare("UPDATE tenant_organizations SET status=?, operation_id=? WHERE org_name=?").run("failed", op.lastInsertRowid, "seedfail20260903100000");'
  ```
- **操作步骤**：
  1. 进入 `seedfail<ts>` 详情页，点击 `data-test="retry-operation"`。
- **预期结果**：
  1. `POST /api/admin/operations/{id}/retry` 返回 `200 { status: "pending", operationId }`。
  2. 组织状态经 `provisioning` 最终进入 `active`（详情页 `org-status` 更新）。
  3. 若 Gitea 资源为可复用（归属与配置匹配），不会重复创建；执行器幂等推进。
  4. 完成后 `seedfail<ts>_admin` 可登录。
- **验证口径**：`GET /api/admin/orgs` 中该组织状态为 `active`。
- **清理**：删除种子组织。

### SUPER-14　删除组织进入 deleting 并最终移除（P0）　关联 #20　（真实流程，破坏性）

- **前置条件**：存在 active 组织 `wf<ts>`（含至少一个成员）。
- **操作步骤**：
  1. 进入组织详情页，在 `data-test="danger-zone"` 输入确认名 `wf<ts>`（`data-test="delete-confirm-input"`）。
  2. 点击 `data-test="delete-org-button"` → 二次确认 `data-test="delete-org-confirm"`。
- **预期结果**：
  1. `DELETE /api/admin/orgs/{org}` 返回 `202 { status: "deleting", orgName, operationId }`。
  2. 删除过程中列表/详情显示「删除中」。
  3. 后台执行器依次清理仓库、组织账号、平台技能记录与 Gitea Organization 后完成，组织从 `/api/admin/orgs` 列表消失（终态 `deleted` 不展示）。
  4. 删除后 `wf<ts>_admin` 登录返回失败（账号已清理）。
- **验证口径**：`GET /api/admin/orgs` 不含 `wf<ts>`；`GET /api/admin/orgs/applications` 中该申请状态为 `approved`（历史保留）。

### SUPER-15　删除失败与重试完成删除（P0）　关联 #20　（DB 种子，破坏性）

- **前置条件**：种子组织 `seeddel<ts>` 状态 `delete_failed`，关联一个 `failed` 的 `organization.delete` Operation（payload 含 `orgName`）。
- **DB 种子**：仿 SUPER-13 方式插入 `kind='organization.delete'`、`status='failed'` 的 Operation，并将租户置为 `delete_failed`（`last_error_json` 记录脱敏原因）。
- **操作步骤**：
  1. 进入 `seeddel<ts>` 详情页，确认 `org-status` 为「删除失败」、`org-last-error` 展示原因。
  2. 点击 `data-test="retry-operation"`。
- **预期结果**：
  1. 重试后组织进入 `deleting`，执行器从已完成步骤继续。
  2. 全部清理成功后组织从列表消失。
  3. 若存在外部/未登记资源，执行器停止自动清理并保持 `delete_failed`，详情展示失败原因（人工处理入口）。
- **验证口径**：`GET /api/admin/orgs` 不再包含 `seeddel<ts>`。

### SUPER-16　审批兼容路径：一次性密码仅展示一次（P2）　关联 #18、#21　（DB 种子）

- **前置条件**：种子 `org_applications` 记录 `encrypted_password = NULL`、`hashed_password = '<legacy>'`、`status = 'pending'`、`org_name = seedlegacy<ts>`（模拟密钥接入前的历史申请）。
- **DB 种子**：
  ```bash
  docker compose exec api node -e 'const db=require("better-sqlite3")("/data/esl.db"); db.prepare("INSERT INTO org_applications (org_name, admin_display_name, hashed_password, encrypted_password, status) VALUES (?,?,?,?,?)").run("seedlegacy20260903100000", "admin", "legacyhash", null, "pending");'
  ```
- **操作步骤**：
  1. 超管进入审批页，对 `seedlegacy<ts>` 点击 `data-test="approve-{id}"`。
- **预期结果**：
  1. 兼容路径返回 `{ status: "approved", initialPassword }`，弹窗 `data-test="initial-password"` 展示一次性密码。
  2. 点击 `data-test="initial-password-close"` 关闭后，页面任意位置不再可见该密码；刷新后也不可见。
  3. `GET /api/admin/orgs/applications` 响应不含密码/密文字段。
- **验证口径**：Network 面板检查 applications 列表响应体无凭据字段。
- **清理**：删除 `seedlegacy<ts>` 组织与申请记录。

### SUPER-17　Operation 审计记录可查询且脱敏（P2）　关联 #17、#21　（API）

- **前置条件**：对某组织执行过批准/取消/拒绝/重试/删除中的任一操作，已知 `operationId`。
- **操作步骤**：带超管 token 调用 `GET /api/admin/operations/{id}/audits`（浏览器 Console `fetch`）。
- **预期结果**：
  1. 返回该 Operation 的审计事件序列（如 `organization.approve`、`organization.cancel`、`operation.retry`、`organization.delete`），含 `actor` 与 `details`。
  2. 审计内容不含密码、密码哈希、密码密文、Authorization Token 或未脱敏的 Gitea 响应。

### SUPER-18　重复删除幂等（P1）　关联 #20　（API）

- **前置条件**：active 组织 `wf<ts>`。
- **操作步骤**：连续两次调用 `DELETE /api/admin/orgs/{org}`（body `{ confirm: org }`）。
- **预期结果**：
  1. 第一次返回 `202 { status: "deleting", operationId }`。
  2. 第二次返回既有 Operation 的同一 `operationId` 与状态，**不重复执行删除副作用**（幂等键 `organization.delete:{org}`）。
- **验证口径**：两次响应 `operationId` 一致；Gitea 侧不重复清理。

---

## C. 组织管理员控制台：成员生命周期（ORG-15 ~ ORG-21）

### ORG-15　添加成员返回 operationId 与一次性密码（P0）　关联 #19　（真实流程）

- **前置条件**：active 组织 `wf<ts>` 的组织管理员已登录。
- **测试数据**：`username=mem<ts>`、初始密码留空（自动生成）。
- **操作步骤**：
  1. 成员页点击 `data-test="open-add-member"` → 填写用户名 → `data-test="add-member-submit"`。
- **预期结果**：
  1. `POST /api/orgs/members` 返回 `202 { status: "pending", username, operationId, password }`。
  2. 弹窗 `data-test="one-time-password"` 展示一次性初始密码。
  3. 点击 `data-test="one-time-password-close"` 关闭后，重开添加弹窗/刷新页面**不再显示**该密码。
  4. 后台执行器完成后，该成员用一次性密码可登录。
- **验证口径**：Network 面板确认密码仅出现在创建响应中，列表接口（`GET /api/orgs/members`）不含密码。

### ORG-16　添加成员密码策略前端拦截（P1）　关联 #16、#19　（真实流程）

- **测试数据**：`username=mem<ts>`、`password` 填 11 位。
- **操作步骤**：打开添加弹窗填写后提交。
- **预期结果**：前端展示密码规则错误，不提交；12 位及以上密码可通过。

### ORG-17　添加成员用户名规则校验（P1）　关联 #16　（真实流程）

- **测试数据**：`username` 依次填 `BadName`（大写）、`bad name`（空格）、超长用户名（拼接 `<org>_<username>` 超过 39 位）。
- **操作步骤**：填写后提交。
- **预期结果**：
  1. 非法用户名前端拦截并提示。
  2. 超长场景即使绕过前端，`POST /api/orgs/members` 返回 `400`（拼接后 Gitea 用户名过长）。

### ORG-18　禁用成员：移除团队并禁止登录（P0，破坏性）　关联 #19　（真实流程）

- **前置条件**：`wf<ts>` 组织含成员 `mem<ts>`（已加入 `all-readers`/`all-writers`），组织管理员已登录。
- **操作步骤**：
  1. 成员列表点击 `data-test="disable-{username}"` → 二次确认 `data-test="disable-member-confirm"`。
- **预期结果**：
  1. `POST /api/orgs/members/{u}/disable` 返回 `202 { status: "pending", operationId }`。
  2. 后台完成后成员从组织全部团队移除；用原密码登录返回 `401`（`login-error` 展示）。
  3. 被禁用户既有 token 访问组织接口被拒（`401/403`）。
- **清理**：该成员为自建数据，可保留待 ORG-19 复用。

### ORG-19　启用成员：恢复登录并重新入默认团队（P1）　关联 #19　（真实流程）

- **前置条件**：成员 `mem<ts>` 处于禁用状态。
- **操作步骤**：
  1. 成员页点击 `data-test="open-enable-member"` → 输入用户名 `mem<ts>`（`data-test="enable-member-username"`）→ `data-test="enable-member-submit"`。
- **预期结果**：
  1. `POST /api/orgs/members/{u}/enable` 返回 `202 { status: "pending", operationId }`。
  2. 后台完成后成员重新加入 `all-readers`/`all-writers`，用原密码登录成功。
- **验证口径**：Gitea 侧确认团队关系恢复（团队列表接口复核）。

### ORG-20　重置成员密码：一次性密码展示与新密码登录（P1）　关联 #19　（真实流程）

- **前置条件**：active 组织含成员 `mem<ts>`。
- **操作步骤**：
  1. 成员列表点击 `data-test="reset-password-{username}"` → 新密码留空 → `data-test="reset-password-submit"`。
- **预期结果**：
  1. `POST /api/orgs/members/{u}/password` 返回 `202`，`one-time-password` 弹窗展示新密码。
  2. 关闭后不再可见；用新密码登录成功。
- **补充**：指定新密码时（12 位以上）同样返回 `202`，用指定密码可登录；短密码前端拦截。

### ORG-21　重复添加成员幂等（P1）　关联 #19　（API）

- **前置条件**：组织管理员 token 可用。
- **操作步骤**：连续两次 `POST /api/orgs/members`（同一 `username`、均不带密码）。
- **预期结果**：
  1. 两次均返回 `202`，且 `operationId` 相同（幂等键 `member.create:{org}:{username}`）。
  2. Gitea 侧不产生重复账号（第二次不重复执行创建副作用）。

---

## D. 端到端主流程（E2E-02）

### E2E-02　组织全生命周期工作流回归（P0）　关联 #15–#22　（真实流程，破坏性）

覆盖「注册（auto）→ provisioning → active → 添加/禁用/启用成员 → 技能权限 → 删除（deleting → 移除）」完整链路，纳入新状态机断言，是重点回归用例。

- **前置条件**：注册模式为 `auto`；超管密码已知；Docker 栈运行。
- **测试数据**：`orgName=wf<ts>`、admin 密码 `<adminPass>`（12 位以上）、成员 `mem<ts>`。
- **操作步骤**：
  1. 注册组织 `wf<ts>`（AUTH-15）→ 断言返回 `provisioning`、显示「组织正在开通」。
  2. 轮询/等待后确认组织 `active`，用 `username=admin`、`org=wf<ts>`、`<adminPass>` 登录（AUTH-03）→ 进入 `/admin/org/members`。
  3. 添加成员 `mem<ts>`（自动生成密码，ORG-15）→ 记录一次性密码。
  4. 退出，用成员登录（AUTH-04）→ 进入 `/admin/member/skills`。
  5. 退出，超管登录，进入组织列表，确认 `wf<ts>` 状态「已激活」。
  6. 进入组织详情，输入确认名删除组织（SUPER-14）。
- **预期结果**：
  1. 步骤 1-4 全部成功：注册返回 provisioning 而非虚假「已开通」；成员创建为可恢复 Operation 且一次性密码可登录。
  2. 步骤 6 成功：删除进入 `deleting`，随后组织从列表消失；删除后组织账号无法登录。
  3. 结束无残留组织/成员；平台注册模式保持 `auto`。
- **验证口径**：`GET /api/admin/orgs` 不含 `wf<ts>`；申请记录状态为 `approved`（历史保留）。

---

## E. 负向/异常用例（NEG-07 ~ NEG-12）

### NEG-07　非 active 组织登录被拒绝（P0）　关联 #21　（DB 种子）

- **前置条件**：正常开通的组织 `wf<ts>`（Gitea 账号存在）；DB 种子将其 `tenant_organizations.status` 临时置为 `deleting`（或 `failed`/`delete_failed`）。
- **操作步骤**：用 `username=admin`、`org=wf<ts>` 登录。
- **预期结果**：
  1. `POST /api/auth/login` 返回 `409`（`Organization is not active: wf<ts>`），`data-test="login-error"` 展示该错误。
  2. 不建立会话、不跳转，停留在 `/admin/login`。
- **清理**：恢复该组织状态为 `active`。

### NEG-08　非 active 组织业务接口被拒绝（P1）　关联 #21、#22　（DB 种子 + API）

- **前置条件**：预取某 active 组织 token；DB 种子将其组织状态置为 `failed`。
- **操作步骤**（浏览器 Console `fetch` 带 token）：
  1. `GET /api/orgs/members`。
  2. `POST /api/skills`（name 指向该组织 scope，如 `@wf<ts>/demo`）。
  3. `POST /api/skills/{scope}/{skill}/permissions`。
- **预期结果**：
  1. 均返回 `409`（`Organization is not active: <org>`，body 含 `status`）。
  2. 上传、发布、权限变更等 `app.ts` preHandler 覆盖的技能接口同样被拦截。
- **清理**：恢复组织状态为 `active`。

### NEG-09　服务端最终校验：绕过前端提交非法值（P1）　关联 #16　（API）

- **操作步骤**（浏览器 Console `fetch`）：
  1. `POST /api/orgs/apply` 提交非法组织名（大写/超长/保留字）。
  2. `POST /api/orgs/apply` 提交 11 位密码。
  3. `POST /api/orgs/members` 提交非法用户名/短密码。
- **预期结果**：均返回 `400` 明确错误（`validateOrgName`/`validatePassword` 规则），错误信息不含敏感内容；服务端是最终校验点，前端拦截可被绕过但服务端仍拒绝。

### NEG-10　对已处理申请重复审批被拒（P1）　关联 #18　（API）

- **前置条件**：存在已批准或已拒绝的申请。
- **操作步骤**：再次调用其 `POST /api/admin/orgs/applications/{id}/approve|reject|cancel`。
- **预期结果**：
  1. `approve`/`reject` 对非 pending 返回 `409`（`has already been processed`）。
  2. `cancel` 对非 pending 返回 `409`（`Only pending applications can be cancelled`）。
  3. 不产生新 Operation（幂等，避免重复副作用）。

### NEG-11　删除未纳管组织被拒绝（P1）　关联 #20　（API）

- **操作步骤**：`DELETE /api/admin/orgs/{不存在的组织名}`（body `{ confirm: 同名 }`）。
- **预期结果**：返回 `404`（`Organization not found or not managed by ESL`）；平台组织（未登记租户）与外部组织一律拒绝自动删除（Resource Provenance 保护）。

### NEG-12　申请列表与状态接口不泄露密码材料（P2）　关联 #21　（API）

- **前置条件**：存在含申请密文的申请。
- **操作步骤**：检查以下响应体（Network 面板 / Console fetch）：
  1. `GET /api/admin/orgs/applications`。
  2. `POST /api/orgs/applications/{org}/status`。
  3. 任意错误响应与审计接口。
- **预期结果**：所有响应不含 `encrypted_password`、`hashed_password`、`password`、Authorization Token 等字段；失败原因脱敏。

---

## 执行顺序与回归策略

1. 推荐按 `A（AUTH-12~18）→ B（SUPER-11~18）→ C（ORG-15~21）→ D（E2E-02）→ E（NEG-07~12）` 顺序执行；E2E-02 依赖前面分组的关键能力。
2. 破坏性用例（ORG-18、SUPER-14、SUPER-15、E2E-02）只对用例自建/种子数据执行，并在分组内靠后。
3. **DB 种子用例**（SUPER-11/12/13/15/16、NEG-07/08）依赖 `data/api/esl.db`，务必在用例开始前执行种子、结束后恢复/清理；种子操作只改本用例自建组织或临时翻转状态的组织。
4. 涉及注册模式的用例（AUTH-15/16）与基线 SUPER-10 互斥：执行完恢复 `auto`（默认），避免污染后续用例。
5. 每次浏览器自动化会话开始时清空 `localStorage`，建议每个角色独立浏览器上下文。
6. 本批用例的行为变化点见「对既有基线用例的影响」，执行时若基线用例（AUTH-06、SUPER-07、ORG-02~06）断言与实际不符，应以后续回归为准更新基线文档。

---

## 更新摘要

| 日期 | 版本 | 核心变更 |
| --- | --- | --- |
| 2026-09-03 | v1.0 | 初版：覆盖 Issue #15–#22 跨系统一致性工作流；新增注册与 Provisioning 状态机（AUTH-12~18）、超管组织状态/重试/删除工作流（SUPER-11~18）、成员生命周期（ORG-15~21）、端到端工作流回归（E2E-02）、负向用例（NEG-07~12）；提供 DB 种子工具与既有基线用例影响对照。 |
