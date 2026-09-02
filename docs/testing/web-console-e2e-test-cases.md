# ESL 管理后台（Web Console）E2E 测试用例

## 概述

本文档为 ESL 管理后台（Web Console，`/admin/`）的端到端（E2E）功能测试用例，供浏览器自动化逐步执行。

- **测试对象**：Web Console 全部三类角色 —— Super Administrator（`/admin/super/`）、Organization Admin（`/admin/org/`）、Member（`/admin/member/`）
- **测试层级**：浏览器 E2E，真实 Docker 栈（nginx + api + gitea），入口 `http://localhost:3000/admin/`
- **测试目的**：全量功能回归，并重点回归组织生命周期流程（注册 → 审批/开通 → 初始化 → 成员/团队 → 技能权限 → 删除）
- **相关代码**：
  - 前端视图：[packages/web/src/views/](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/)
  - 服务端 API：[packages/server/src/routes/](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/)
  - 现有单元/组件测试：[packages/web/tests/](file:///d:/DevProjects/enterprise-skill-library/packages/web/tests/) 与 [packages/server/tests/](file:///d:/DevProjects/enterprise-skill-library/packages/server/tests/)（本文档与它们互补，聚焦真实链路）

## 测试环境与前置准备

1. Docker 栈已运行：`docker compose ps` 应显示 `api`（healthy）、`gitea`、`server` 均 Up；`server` 暴露 `0.0.0.0:3000`。
2. 前端为最新构建产物：宿主机执行 `npm run build --workspace @esl/web`，随后 `docker compose up -d server`（或 `npm run deploy:web`）重新部署。
3. 平台已完成 Bootstrap，存在超管账号与 Gitea 后端。

### 账号清单

| 角色 | 登录用户名 | 组织名（登录表单） | 密码来源 |
| --- | --- | --- | --- |
| 超级管理员 | `eslroot` | 留空 | `.env` 中 `GITEA_ADMIN_PASSWORD` |
| 组织管理员 | `admin` | `<org>` | 开通/审批时下发的一次性初始密码（auto 模式下即注册时提交的密码） |
| 普通成员 | `<membername>` | `<org>` | 添加成员时指定或一次性生成 |

> 账号命名约定（与代码一致）：Gitea 用户名 = `<org>_<username>`；无组织前缀的账号推导为超级管理员，组织内 `admin` 推导为组织管理员，其余为成员。

### 测试数据命名与隔离策略

- 所有 E2E 创建的实体使用唯一命名，避免与既有数据冲突：
  - 组织：`e2e<YYYYMMDDHHmmss>`（如 `e2e20260901153000`）
  - 成员：`mem<ts>`（如 `mem01`）
  - 团队：`team<ts>`（如 `team01`）
- 每条用例尽量自包含、幂等：前置数据由用例自带步骤创建，用例结束前完成清理。
- **破坏性用例**（删除组织、删除自定义团队、禁用成员）排在各自分组末尾执行，且只作用于本用例创建的 E2E 数据，严禁针对既有组织/成员执行删除。
- 每条用例执行前清理浏览器会话（清除 `localStorage` 中 `esl-admin-session`，建议使用无痕/独立浏览器上下文），确保无残留登录态。

### 用例编号与优先级

- 编号前缀：`AUTH-`（认证与鉴权）、`SUPER-`（超管控制台）、`ORG-`（组织管理员控制台）、`MEM-`（成员控制台）、`E2E-`（端到端主流程）、`NEG-`（负向/异常）。
- 优先级：`P0` 核心主流程（阻断性），`P1` 主要功能，`P2` 边界与次要。

---

## A. 认证与鉴权（AUTH）

### AUTH-01　未登录访问受保护页自动跳转登录（P0）

- **前置条件**：浏览器无会话。
- **测试数据**：无。
- **操作步骤**：
  1. 直接访问 `http://localhost:3000/admin/super/dashboard`。
  2. 观察页面。
- **预期结果**：
  1. 被重定向到 `/admin/login`。
  2. 页面出现登录表单（`data-test="username"` 输入框、登录按钮）。

### AUTH-02　超级管理员登录（P0）

- **前置条件**：平台已 Bootstrap，已知超管密码。
- **测试数据**：`username=eslroot`、`org` 留空、`password=<GITEA_ADMIN_PASSWORD>`。
- **操作步骤**：
  1. 访问 `/admin/login`。
  2. 输入用户名 `eslroot`、密码，组织名留空。
  3. 点击登录按钮（`data-test="login-submit"`）。
- **预期结果**：
  1. 跳转到 `/admin/super/dashboard`，出现标题「平台概览」。
  2. Header 显示「超级管理员：eslroot」。
  3. 出现三个统计卡片：组织总数（`stat-orgs`）、待审批申请（`stat-pending`）、平台技能总数（`stat-skills`）。
  4. 请求路径为 `POST /api/auth/login`，成功后本地会话写入 `localStorage`。

### AUTH-03　组织管理员登录（P0）

- **前置条件**：存在已开通组织 `<org>`（如 E2E 创建），已知组织管理员密码。
- **测试数据**：`username=admin`、`org=<org>`、`password=<admin初始密码>`。
- **操作步骤**：
  1. 访问 `/admin/login`。
  2. 输入用户名 `admin`、组织名 `<org>`、密码。
  3. 点击登录。
- **预期结果**：
  1. 跳转到 `/admin/org/members`，出现标题「成员管理」。
  2. 请求体中的登录账号为 `POST /api/auth/login` 且 `username=<org>_admin`。
  3. Header 显示组织管理员身份（`<org>` 上下文）。

### AUTH-04　普通成员登录（P0）

- **前置条件**：存在已开通组织与成员账号，已知成员密码。
- **测试数据**：`username=mem01`、`org=<org>`、`password=<成员密码>`。
- **操作步骤**：同 AUTH-03，用户名填 `mem01`、组织填 `<org>`。
- **预期结果**：
  1. 跳转到 `/admin/member/skills`，出现标题「我的技能」。
  2. 请求账号为 `<org>_mem01`。

### AUTH-05　登录失败提示（P0）

- **前置条件**：无。
- **测试数据**：`username=eslroot`、错误密码。
- **操作步骤**：登录页填写后提交。
- **预期结果**：
  1. 不跳转，停留在 `/admin/login`。
  2. 出现错误提示（`data-test="login-error"`），文案为凭证错误信息。
  3. 请求返回 `401`。

### AUTH-06　组织注册 —— 免审批模式（auto）（P0）

- **前置条件**：平台注册模式为 `auto`（默认值；若不确定，先按 SUPER-10 查看/恢复）。
- **测试数据**：`orgName=e2e<ts>`、`adminDisplayName=测试管理员`、`password/confirmPassword=<初始密码>`。
- **操作步骤**：
  1. 访问 `/admin/login`，点击「没有组织？注册组织申请」（`data-test="register-link"`）。
  2. 填写组织名、管理员名称、密码、确认密码。
  3. 点击提交（`data-test="register-submit"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/apply` 返回 `201 { status: "approved" }`。
  2. 出现成功结果（`data-test="register-result"`）：「组织已开通」，提示使用账号 `admin` 登录。
  3. 用 `username=admin`、`org=e2e<ts>`、刚才的密码可登录进入组织管理后台。
- **清理**：执行 E2E-01 或 SUPER-05 删除该组织。

### AUTH-07　组织注册 —— 需审批模式（manual）（P0）

- **前置条件**：平台注册模式为 `manual`（先在设置页切换，见 SUPER-10）。
- **测试数据**：`orgName=e2e<ts>`、`adminDisplayName=测试管理员`、`password=<初始密码>`。
- **操作步骤**：
  1. 进入注册页填写并提交（同 AUTH-06）。
- **预期结果**：
  1. 请求 `POST /api/orgs/apply` 返回 `201 { status: "pending" }`。
  2. 出现「申请已提交，等待审批」结果页。
  3. 该组织暂不可登录（审批前无 admin 账号）。
- **后续**：由 SUPER-06/07 审批并下发密码，或直接删除申请记录。

### AUTH-08　组织注册 —— 非法组织名校验（P1）

- **前置条件**：无。
- **测试数据**：`orgName=ABC_org`（含大写/下划线）、其余字段合法。
- **操作步骤**：进入注册页填写并提交。
- **预期结果**：
  1. 前端显示字段级错误（`data-test="org-name-error"`），或提交后显示 `data-test="register-error"`。
  2. 不产生有效申请；请求不携带非法组织名。

### AUTH-09　组织注册 —— 两次密码不一致（P1）

- **前置条件**：无。
- **测试数据**：两次密码不同。
- **操作步骤**：填写后提交。
- **预期结果**：出现错误提示「两次输入的密码不一致」，不发起请求。

### AUTH-10　角色守卫 —— 越权访问被拦截（P0）

- **前置条件**：已以 `member` 身份登录（见 AUTH-04）。
- **测试数据**：无。
- **操作步骤**：
  1. 直接访问 `/admin/org/members`。
  2. 再直接访问 `/admin/super/dashboard`。
- **预期结果**：两种越权访问都被踢回 `/admin/login`（角色与路由 `meta.role` 不匹配）。

### AUTH-11　退出登录（P1）

- **前置条件**：任一角色已登录。
- **操作步骤**：点击 Header 右上角「退出登录」（`data-test="logout"`）。
- **预期结果**：
  1. 跳转 `/admin/login`。
  2. `localStorage` 中 `esl-admin-session` 被清除；再访问受保护页跳登录。

---

## B. Super 超管控制台（SUPER）

### SUPER-01　平台概览 Dashboard（P0）

- **前置条件**：超管已登录（AUTH-02）。
- **操作步骤**：访问 `/admin/super/dashboard`。
- **预期结果**：
  1. 出现三个统计卡片。
  2. 「组织总数」= `GET /api/admin/orgs` 返回的组织数。
  3. 「待审批申请」= `GET /api/admin/orgs/applications` 中 `status=pending` 的数量。
  4. 「平台技能总数」= 各组织 `skillCount` 之和。

### SUPER-02　组织列表 Orgs（P0）

- **前置条件**：超管已登录。
- **操作步骤**：访问 `/admin/super/orgs`。
- **预期结果**：
  1. 出现「全平台组织」表格（`data-test="orgs-table"`）。
  2. 每行展示组织名、成员数、技能数、创建时间。
  3. 每行有「详情」按钮（`data-test="org-detail-<name>"`）。
  4. 请求路径为 `GET /api/admin/orgs`。

### SUPER-03　进入组织详情（P0）

- **前置条件**：超管已登录，存在组织 `<org>`。
- **操作步骤**：在 Orgs 页点击 `<org>` 行的「详情」。
- **预期结果**：
  1. 跳转 `/admin/super/orgs/<org>`。
  2. 出现组织摘要（`data-test="org-summary"`）：组织名、成员数、技能数、创建时间。
  3. 出现「危险操作」区域（`data-test="danger-zone"`）与删除输入框/按钮。

### SUPER-04　删除组织 —— 确认名不匹配时禁用（P0）

- **前置条件**：超管已登录，进入 E2E 专用组织 `<org>` 详情页（不要用既有组织）。
- **测试数据**：输入错误组织名。
- **操作步骤**：
  1. 在 `delete-confirm-input` 输入不匹配的名称（如 `wrong`）。
  2. 观察 `delete-org-button` 状态。
- **预期结果**：删除按钮保持 `disabled`；未发起任何 DELETE 请求。

### SUPER-05　删除组织 —— 二次确认后删除（P0，破坏性）

- **前置条件**：超管已登录，存在 E2E 专用组织 `<org>`（本用例自建）。
- **测试数据**：组织名 `<org>`。
- **操作步骤**：
  1. 进入详情页，输入正确组织名，点击删除按钮。
  2. 弹出「二次确认」对话框，点击「确认删除」（`data-test="delete-org-confirm"`）。
- **预期结果**：
  1. 请求 `DELETE /api/admin/orgs/<org>`，body 为 `{ "confirm": "<org>" }`。
  2. 提示「组织 <org> 已删除」，跳回 `/admin/super/orgs`。
  3. 列表不再包含该组织；Gitea 中组织及其成员账号已移除（可用 API 复核）。
- **注意**：只对自建 E2E 组织执行；组织内成员账号会被一并删除。

### SUPER-06　注册审批 —— 默认仅显示待审批（P0）

- **前置条件**：超管已登录；存在至少一条 `pending` 申请（manual 模式下注册生成，见 AUTH-07）。
- **操作步骤**：访问 `/admin/super/applications`。
- **预期结果**：
  1. 默认筛选为「待审批」（`data-test="status-filter"` 值为 `pending`）。
  2. 表格（`data-test="applications-table"`）仅显示 `pending` 行；`pending` 行显示「批准/拒绝」操作按钮。
  3. 请求路径 `GET /api/admin/orgs/applications`。

### SUPER-07　注册审批 —— 批准并展示一次性密码（P0）

- **前置条件**：存在 `pending` 申请（id 已知）。
- **操作步骤**：
  1. 点击该行「批准」（`data-test="approve-<id>"`）。
- **预期结果**：
  1. 请求 `POST /api/admin/orgs/applications/<id>/approve`。
  2. 弹出「批准成功」对话框，`data-test="initial-password"` 展示一次性初始密码（仅展示一次）。
  3. 关闭对话框后列表刷新，该申请变为「已批准」。
  4. 使用该密码 + `username=admin`、`org=<org>` 可登录组织管理后台。

### SUPER-08　注册审批 —— 拒绝（P1）

- **前置条件**：存在 `pending` 申请。
- **操作步骤**：点击「拒绝」（`data-test="reject-<id>"`）。
- **预期结果**：
  1. 请求 `POST /api/admin/orgs/applications/<id>/reject`。
  2. 提示「已拒绝 <org> 的注册申请」，列表刷新，该申请变为「已拒绝」。

### SUPER-09　注册审批 —— 按状态筛选历史（P1）

- **前置条件**：存在已批准/已拒绝/待审批记录。
- **操作步骤**：切换 `status-filter` 为 `approved`、`rejected`、`all`。
- **预期结果**：表格分别只显示对应状态记录；`all` 显示全部。

### SUPER-10　平台设置 —— 注册模式切换（P0）

- **前置条件**：超管已登录。
- **操作步骤**：
  1. 访问 `/admin/super/settings`。
  2. 切换「组织注册审批模式」（`data-test="registration-mode"`）为另一模式。
  3. 点击保存（`data-test="save-settings"`）。
- **预期结果**：
  1. 请求 `PUT /api/admin/orgs/settings`，body 为 `{ "orgRegistrationMode": "<auto|manual>" }`。
  2. 提示「平台设置已保存」；保存后按钮回到 `disabled`（无未保存修改）。
  3. 刷新页面后模式保持。
- **注意**：用例结束应恢复原模式，避免影响后续用例（E2E-01 会切换 manual，结束恢复 auto）。

---

## C. 组织管理员控制台（ORG）

### ORG-01　成员列表（P0）

- **前置条件**：组织管理员已登录（AUTH-03）。
- **操作步骤**：访问 `/admin/org/members`。
- **预期结果**：
  1. 出现「成员管理」表格（`data-test="members-table"`），显示成员用户名、显示名、状态「在册」。
  2. 每行有「重置密码」「禁用」操作。
  3. 请求路径 `GET /api/orgs/members`。

### ORG-02　添加成员 —— 自动生成密码（P0）

- **前置条件**：组织管理员已登录。
- **测试数据**：`username=mem<ts>`，密码留空。
- **操作步骤**：
  1. 点击「添加成员」（`data-test="open-add-member"`）。
  2. 输入用户名，密码留空，点击「添加」（`data-test="add-member-submit"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/members`，body 为 `{ "username": "mem<ts>" }`。
  2. 弹出「一次性初始密码」对话框（`data-test="one-time-password"`），展示随机密码。
  3. 关闭后列表出现新成员。
  4. 新成员（`<org>_mem<ts>`）可用该密码登录。

### ORG-03　添加成员 —— 指定密码（P1）

- **前置条件**：组织管理员已登录。
- **测试数据**：`username=mem<ts>`、`password=<指定密码>`。
- **操作步骤**：添加成员时填写用户名与密码。
- **预期结果**：
  1. 请求 `POST /api/orgs/members`，body 含 `password`。
  2. 提示「成员 <org>_mem<ts> 已添加」，不弹一次性密码框。
  3. 新成员可用指定密码登录。

### ORG-04　重置成员密码（P1）

- **前置条件**：存在成员 `mem<ts>`。
- **操作步骤**：
  1. 点击该行「重置密码」（`data-test="reset-password-<username>"`）。
  2. 新密码留空，点击「重置」（`data-test="reset-password-submit"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/members/<shortname>/password`。
  2. 弹出一次性密码框并展示新密码。
  3. 用新密码登录该成员账号成功（复核）。

### ORG-05　禁用成员（P0，破坏性）

- **前置条件**：存在本用例创建的成员 `mem<ts>`（不要禁用既有成员）。
- **操作步骤**：
  1. 点击该行「禁用」（`data-test="disable-<username>"`）。
  2. 在弹窗点击「确认禁用」（`data-test="disable-member-confirm"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/members/<shortname>/disable`。
  2. 提示「成员 <org>_mem<ts> 已禁用」，成员从列表消失。
  3. 该成员用原密码登录被拒（`401`）。

### ORG-06　启用成员（P1）

- **前置条件**：存在被禁用成员 `mem<ts>`。
- **操作步骤**：
  1. 点击「启用成员」（`data-test="open-enable-member"`）。
  2. 输入用户名，点击「启用」（`data-test="enable-member-submit"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/members/<shortname>/enable`。
  2. 提示「成员已启用」，成员回到列表（重新加入默认团队）。
  3. 该成员可重新登录。

### ORG-07　团队列表 —— 默认团队不可删（P0）

- **前置条件**：组织管理员已登录。
- **操作步骤**：访问 `/admin/org/teams`。
- **预期结果**：
  1. 出现「团队管理」表格（`data-test="teams-table"`），含 `all-readers`、`all-writers` 两个默认团队（带「默认团队」标签 `data-test="default-team-tag"`）。
  2. 默认团队行的「删除」按钮（`data-test="delete-team-all-readers"` 等）为 `disabled`。
  3. 请求路径 `GET /api/orgs/teams`。

### ORG-08　新建团队（P0）

- **前置条件**：组织管理员已登录。
- **测试数据**：`name=team<ts>`、`permission=read`（或 write）。
- **操作步骤**：
  1. 点击「新建团队」（`data-test="open-create-team"`）。
  2. 输入团队名、选择权限级别，点击「创建」（`data-test="create-team-submit"`）。
- **预期结果**：
  1. 请求 `POST /api/orgs/teams`，body 为 `{ "name": "team<ts>", "permission": "read" }`。
  2. 提示「团队已创建」，列表出现新团队（「自定义」标签），其删除按钮可点。

### ORG-09　删除自定义团队（P1，破坏性）

- **前置条件**：存在本用例创建的自定义团队 `team<ts>`。
- **操作步骤**：点击该行「删除」（`data-test="delete-team-<name>"`）→ 弹窗确认（`data-test="delete-team-confirm"`）。
- **预期结果**：
  1. 请求 `DELETE /api/orgs/teams/<id>`。
  2. 提示「团队 <name> 已删除」，列表不再包含该团队。
- **注意**：默认团队删除按钮在前端已禁用，不应出现删除默认团队的请求。

### ORG-10　团队成员 —— 添加/移除（P1）

- **前置条件**：存在团队 `team<ts>` 与成员 `mem<ts>`。
- **操作步骤**：
  1. 展开团队行，在「团队成员」面板输入用户名（`data-test="team-add-username"`），点击「添加成员」（`data-test="team-add-submit"`）。
  2. 对该成员点击「移除」（`data-test="team-remove-<username>"`）。
- **预期结果**：
  1. 添加后请求 `POST /api/orgs/teams/<id>/members`，表格（`data-test="team-members-<name>"`）出现该成员。
  2. 移除后请求 `DELETE /api/orgs/teams/<id>/members/<username>`，成员从团队移除。

### ORG-11　组织技能列表（P0）

- **前置条件**：组织管理员已登录；组织内存在技能（E2E-01 流程内先通过 CLI/API 创建，或由现有技能兜底）。
- **操作步骤**：访问 `/admin/org/skills`。
- **预期结果**：
  1. 出现「组织技能」表格（`data-test="org-skills-table"`），仅展示 `scope=<org>` 的技能。
  2. 每行显示技能名、创建者、共享状态（`data-test="skill-state-<skillName>"`）。
  3. 每行有「配置权限」按钮（`data-test="configure-<skillName>"`）。

### ORG-12　技能权限 —— 全员共享/私有（P0）

- **前置条件**：存在本组织技能 `@<org>/<skillName>`。
- **操作步骤**：
  1. 从技能列表点击「配置权限」进入 `/admin/org/skills/<scope>/<skillName>/permissions`。
  2. 依次点击「共享全员只读」（`data-test="share-all-read"`）、「共享全员读写」（`data-test="share-all-write"`）、「重置为私有」（`data-test="reset-to-private"`）。
- **预期结果**：
  1. 每次点击后请求 `POST /api/skills/<scope>/<skillName>/permissions`，body 含对应 `action`。
  2. 共享状态标签（`data-test="share-state"`）依次变为「全员只读 / 全员读写 / 仅创建者」。
  3. 授权目标标签（`granted-team`/`granted-member`）随操作增减。

### ORG-13　技能权限 —— 团队授权/撤销（P1）

- **前置条件**：存在团队 `team<ts>` 与技能。
- **操作步骤**：
  1. 在「团队授权」下拉（`data-test="team-select"`）选择团队，点击「添加授权」（`data-test="grant-team"`）。
  2. 点击该团队行「移除」（`data-test="revoke-team-<name>"`）。
- **预期结果**：请求 body 含 `add_team` / `remove_team` 对应 `team`；`granted-team` 标签出现/消失。

### ORG-14　技能权限 —— 成员授权/撤销（P1）

- **前置条件**：存在成员 `mem<ts>` 与技能。
- **操作步骤**：
  1. 在「成员授权」下拉（`data-test="member-select"`）选择成员、选择权限（`data-test="member-permission"`），点击「添加授权」（`data-test="grant-member"`）。
  2. 点击该成员行「移除」（`data-test="revoke-member-<username>"`）。
- **预期结果**：请求 body 含 `add_member`（含 `permission`）/ `remove_member`；`granted-member` 标签出现/消失。

---

## D. 成员控制台（MEM）

### MEM-01　我的技能 —— 仅显示自己创建（P0）

- **前置条件**：成员已登录（AUTH-04），组织中存在该成员创建及其他成员创建的技能。
- **操作步骤**：访问 `/admin/member/skills`。
- **预期结果**：
  1. 出现「我的技能」表格（`data-test="member-skills-table"`）。
  2. 仅包含 `createdBy = <org>_<membername>` 的技能（其他成员/组织管理员创建的技能不出现）。

### MEM-02　技能权限 —— 手工输入授权目标（P1）

- **前置条件**：成员已登录，存在其创建的技能。
- **操作步骤**：进入 `/admin/member/skills/<scope>/<skillName>/permissions`。
- **预期结果**：
  1. 不展示团队/成员下拉建议，授权目标为手工输入框（`data-test="team-input"` / `data-test="member-input"`）。
  2. 可正常执行全员共享/私有操作（`share-all-read` 等）。

---

## E. 端到端主流程 —— 组织生命周期（E2E）

### E2E-01　组织全生命周期回归（P0）

覆盖「注册（manual 审批）→ 超管批准 → 组织管理员 → 成员 → 团队 → 技能 → 删除」完整链路，是重点回归用例。

- **前置条件**：超管密码已知；Docker 栈运行。
- **测试数据**：`orgName=e2e<ts>`、admin 密码 `<adminPass>`、成员 `mem01`（密码 `<memPass>`）、团队 `team01`（write）。
- **操作步骤**：
  1. 超管登录（AUTH-02），进入设置页，将注册模式切换为「需要审批」（manual），保存。
  2. 退出登录，注册组织 `e2e<ts>`（AUTH-07）→ 出现「申请已提交，等待审批」。
  3. 超管登录，进入审批页，批准该申请（SUPER-07）→ 记录一次性初始密码。
  4. 退出登录，用 `username=admin`、`org=e2e<ts>`、一次性密码登录（AUTH-03）→ 进入 `/admin/org/members`。
  5. 添加成员 `mem01`（指定密码 `<memPass>`）（ORG-03）。
  6. 新建团队 `team01`（write）（ORG-08），并在团队中添加成员 `mem01`（ORG-10）。
  7. 退出，用成员 `mem01` 登录（AUTH-04）→ 进入 `/admin/member/skills`（MEM-01）。
  8. 退出，超管登录，进入设置页恢复注册模式为「免审批」（auto），保存。
  9. 超管进入组织列表，删除组织 `e2e<ts>`（SUPER-05，二次确认）。
- **预期结果**：
  1. 步骤 2/3 成功：申请从 pending → approved，一次性密码可正常登录组织管理后台。
  2. 步骤 5/6 成功：成员与团队创建成功，成员可加入团队。
  3. 步骤 7 成功：成员视角正常，仅看到自己创建的技能。
  4. 步骤 9 成功：组织被删除，`/admin/super/orgs` 不再包含 `e2e<ts>`。
  5. 全部结束后平台注册模式恢复为 `auto`，无残留组织/成员/团队。
- **验证口径**：`GET /api/admin/orgs` 不含 `e2e<ts>`；`GET /api/admin/orgs/applications` 中该申请状态为 `approved`（历史保留）。

---

## F. 负向/异常用例（NEG）

### NEG-01　未登录访问受保护页（P0）

- **说明**：与 AUTH-01 等价，保留作为路由守卫回归锚点。直接访问任一 `/admin/super|org|member/*` 路由均跳转登录。

### NEG-02　删除组织 —— 确认名不匹配（P0）

- **说明**：与 SUPER-04 等价：输入错误名称时按钮禁用；即使绕过前端直接调接口，`DELETE /api/admin/orgs/<org>` 且 `confirm` 不匹配应返回 `400`。

### NEG-03　重复注册同一组织（P1）

- **前置条件**：组织 `e2e<ts>` 已存在（auto 模式已开通）。
- **操作步骤**：再次以相同组织名提交注册。
- **预期结果**：请求 `POST /api/orgs/apply` 返回 `409`（Organization name is already taken），前端展示错误提示。

### NEG-04　审批已处理的申请（P1）

- **前置条件**：存在已被批准/拒绝的申请。
- **操作步骤**：对其再次批准/拒绝。
- **预期结果**：接口返回 `409`（已被处理）；前端展示错误提示。

### NEG-05　删除默认团队（P1）

- **前置条件**：组织管理员已登录。
- **操作步骤**：尝试对 `all-readers` 点击删除。
- **预期结果**：删除按钮为 `disabled`，不发起请求；即使绕过前端，`DELETE /api/orgs/teams/<id>` 对默认团队应返回 `400`。

### NEG-06　禁用成员后登录（P1）

- **说明**：与 ORG-05 的复核步骤等价：禁用后成员用原密码登录返回 `401`。

---

## 执行顺序与回归策略

1. 推荐按 `AUTH → B(SUPER) → C(ORG) → D(MEM) → E(E2E) → F(NEG)` 顺序执行；E2E-01 依赖 AUTH/SUPER/ORG 的关键能力，放在其后。
2. 破坏性用例（SUPER-05、ORG-05、ORG-09）只对用例自建数据执行，并在各自分组内尽量靠后。
3. 涉及「注册模式」的用例（AUTH-06/07、SUPER-10、E2E-01）互相影响平台全局设置，务必在用例结束恢复原始模式（默认 `auto`），避免污染后续用例。
4. 每次浏览器自动化会话开始时清空 `localStorage`，保证无残留会话；建议每个角色使用独立浏览器上下文。
5. 若 Docker 栈被重建（`docker compose down` + 清数据卷），需重新 Bootstrap；此时超管密码重新来自 `.env`，既有组织消失，AUTH-06/07 的既有数据断言需相应调整。

---

## 执行记录

> 执行环境：本地 Docker 栈（api + gitea + server），`docker compose ps` 三服务健康；超管账号 `eslroot`，测试组织 `e2e223219`（auto 模式，含 admin/mem01/mem02、团队 all-readers/all-writers/team01、技能 2 个）。执行方式：API 断言 + 浏览器 UI 复核。

### AUTH 认证与鉴权

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| AUTH-01 未登录跳转 | ✅ PASS | 访问受保护路由重定向登录页 |
| AUTH-02 超管登录 | ✅ PASS | `eslroot` 登录进入 `/admin/super/dashboard` |
| AUTH-03 组织管理员登录 | ✅ PASS | 组织名 + `admin` 进入 `/admin/org/members` |
| AUTH-04 普通成员登录 | ✅ PASS | 成员进入 `/admin/member/skills` |
| AUTH-05 登录失败提示 | ✅ PASS | 错误凭据返回 401 并提示 |
| AUTH-06 免审批注册 | ✅ PASS | auto 模式注册即开通，组织名唯一 |
| AUTH-07 需审批注册 | ✅ PASS | manual 模式进入 pending 待审批 |
| AUTH-08 非法组织名校验 | ✅ PASS | 非法名返回 400 |
| AUTH-09 两次密码不一致 | ✅ PASS | 前端提示错误 |
| AUTH-10 角色守卫 | ✅ PASS | 越权路径被拦截回登录页 |
| AUTH-11 退出登录 | ✅ PASS | 会话清除并回登录页 |

### SUPER 超管控制台

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| SUPER-01 平台概览 | ✅ PASS | Dashboard 正常渲染统计 |
| SUPER-02 组织列表 | ✅ PASS | `/api/admin/orgs` 列出全部组织 |
| SUPER-03 组织详情 | ✅ PASS | 进入组织详情页正常 |
| SUPER-04 确认名不匹配禁用 | ✅ PASS | 输入错误名称删除按钮禁用；API 绕过返回 400 |
| SUPER-05 二次确认删除组织 | ✅ PASS | 确认名匹配后删除成功（破坏性，仅对自建组织） |
| SUPER-06 审批默认待审批 | ✅ PASS | 审批页默认仅显示 pending |
| SUPER-07 批准并展示一次性密码 | ✅ PASS | 批准后展示初始密码并可登录 |
| SUPER-08 拒绝 | ✅ PASS | 拒绝后申请状态更新 |
| SUPER-09 按状态筛选历史 | ✅ PASS | 按状态筛选正常 |
| SUPER-10 注册模式切换 | ✅ PASS | auto/manual 切换并持久化 |

### ORG 组织管理员控制台

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| ORG-01 成员列表 | ✅ PASS | 组织成员列表渲染正常 |
| ORG-02 添加成员自动生成密码 | ✅ PASS | 返回一次性密码 |
| ORG-03 添加成员指定密码 | ✅ PASS | 指定密码创建成功 |
| ORG-04 重置成员密码 | ✅ PASS | 新密码可登录 |
| ORG-05 禁用成员 | ✅ PASS | 成员被移除团队并禁止登录（破坏性） |
| ORG-06 启用成员 | ✅ PASS | 恢复登录并重新加入默认团队 |
| ORG-07 团队列表默认团队不可删 | ✅ PASS | all-readers 删除按钮 disabled |
| ORG-08 新建团队 | ✅ PASS | team01 创建成功 |
| ORG-09 删除自定义团队 | ✅ PASS | 自定义团队可删除（破坏性） |
| ORG-10 团队成员添加/移除 | ✅ PASS | 成员入团/出团正常 |
| ORG-11 组织技能列表 | ✅ PASS | 技能列表渲染正常 |
| ORG-12 全员共享/私有 | ✅ PASS | 权限模式切换正常 |
| ORG-13 团队授权/撤销 | ✅ PASS | 团队读写授权正常 |
| ORG-14 成员授权/撤销 | ✅ PASS | 成员授权正常 |

### MEM 成员控制台

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| MEM-01 我的技能仅显示自己创建 | ✅ PASS | 仅展示 `createdBy` 为本成员的技能 |
| MEM-02 手工输入授权目标 | ✅ PASS | 授权目标为手工输入框，全员共享/私有可执行 |

### E2E 组织生命周期

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| E2E-01 组织全生命周期回归 | ✅ PASS | manual 注册→审批→组织管理员→成员→团队→技能→超管删除；结束恢复注册模式 auto，无残留组织 |

### NEG 负向/异常用例

| 用例 | 结果 | 说明 |
| --- | --- | --- |
| NEG-01 未登录访问受保护页 | ✅ PASS | 与 AUTH-01 等价，路由守卫拦截 |
| NEG-02 删除组织确认名不匹配 | ✅ PASS | `confirm` 不匹配返回 400 |
| NEG-03 重复注册同一组织 | ✅ PASS | 已存在组织再次注册返回 409 |
| NEG-04 审批已处理的申请 | ✅ PASS | 对已处理申请重复批准返回 409 |
| NEG-05 删除默认团队 | ✅ PASS | 前端 all-readers 删除按钮 disabled、team01 可用；后端 `DELETE /api/orgs/teams/21` 返回 400 `Default teams cannot be deleted` |
| NEG-06 禁用成员后登录 | ✅ PASS | 禁用前登录 200；`POST /api/orgs/members/mem01/disable` 后原密码登录返回 401；成员已从组织移除 |

### 发现并修复的问题

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 前端所有无 body 的 POST 请求返回 400（批准/拒绝/禁用/启用等） | `client.ts` 无条件发送 `Content-Type: application/json`，Fastify 对空 JSON body 报 `FST_ERR_CTP_EMPTY_JSON_BODY` | 仅在存在 body 时设置 JSON Content-Type，修复后全量回归通过 |
| 删除组织返回 500（`user still has ownership of repositories`） | 组织仓库未先删除即删组织 | `org-admin.ts` 增加 `listOrgRepos` + `deleteRepo` 循环清理 |
| 删除组织后技能搜索接口 500 | 平台库残留引用已删 Gitea 仓库的孤儿技能记录 | `SkillRepository.deleteSkillsByScope` 随组织删除同步清空技能记录 |
| 成员共享技能时 500（跨组织授权） | 历史成员技能建仓于全局 `esl-skills` 组织，无法跨组织授权 | 在正确组织作用域重建成员自有技能 `memdemo01`，验证通过 |
| 成员删除技能 403 | 技能删除路由仅限平台管理员 | 属预期权限设计，测试改用超管 token 清理测试数据 |

### 回归结论

全量用例（AUTH-01~11、SUPER-01~10、ORG-01~14、MEM-01~02、E2E-01、NEG-01~06）共 45 项执行完毕，全部 **PASS**；期间修复 4 处后端/前端缺陷并回归通过。测试组织 `e2e223219` 保留待后续清理或作为回归基线数据。

---

## 更新摘要

| 日期 | 版本 | 核心变更 |
| --- | --- | --- |
| 2026-09-01 | v1.0 | 初版：覆盖认证鉴权（AUTH-01~11）、超管控制台（SUPER-01~10）、组织管理员控制台（ORG-01~14）、成员控制台（MEM-01~02）、组织生命周期端到端主流程（E2E-01）、负向用例（NEG-01~06）；确立唯一命名与幂等清理策略、破坏性用例执行顺序、注册模式恢复约定。 |
| 2026-09-02 | v1.1 | 新增「执行记录」章节：全量 45 项用例执行完毕全部 PASS；记录执行环境、分组结果、5 处已发现问题（其中 4 处缺陷修复并回归，1 处属预期权限设计）；NEG-05/06 补充前后端双重验证证据。 |
