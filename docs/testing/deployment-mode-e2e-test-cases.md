# 部署模式与默认组织（单组织 / 多组织）E2E 测试用例

## 概述

本文档为 ESL「部署模式与默认组织」（ADR-0022，GitHub issues #29–#36）特性的端到端测试用例，供浏览器自动化 + API 断言逐步执行。

- **测试对象**：平台设置（`deployment_mode` / `default_org`）、匿名平台信息端点、登录契约（org 省略）、单组织门禁、默认组织删除守卫、Web 登录/注册自适应、Bootstrap 单组织变体、注册硬拒绝、CLI 登录自适应。
- **测试层级**：浏览器 E2E（Web Console）+ HTTP API 断言 + CLI 行为断言，真实 Docker 栈（nginx + api + gitea）。
- **测试目的**：覆盖单组织 / 多组织双向切换、默认组织设置与守卫、登录解析、冻结组织 token 立即失效、Web/CLI 自适应交互，以及 Bootstrap 单组织声明。
- **相关代码**：
  - 平台设置服务：[platform-config.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/services/platform-config.ts)
  - 平台设置路由：[org-admin.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/org-admin.ts)（`/api/admin/orgs/settings`、`DELETE /api/admin/orgs/:orgName`）
  - 登录路由：[auth.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/auth.ts)
  - 单组织门禁与匿名端点：[app.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/app.ts)
  - 注册申请路由：[orgs.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/orgs.ts)
  - Bootstrap 单组织变体：[single-org-bootstrap.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/services/single-org-bootstrap.ts)
  - 配置解析：[config.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/config.ts)
  - Web 登录页：[LoginView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/LoginView.vue)
  - Web 注册页：[RegisterView.vue](file:///d:/DevProjects/enterprise-skill-library/packages/web/src/views/RegisterView.vue)
  - CLI 登录：[login.ts](file:///d:/DevProjects/enterprise-skill-library/packages/cli/src/commands/login.ts)

## 测试环境与前置准备

1. Docker 栈已运行：`docker compose ps` 应显示 `api`（healthy）、`gitea`、`server` 均 Up；`server` 暴露 `0.0.0.0:3000`。
2. 前端为最新构建产物：宿主机执行 `npm run build --workspace @esl/web`，随后 `docker compose up -d server` 重新部署。
3. 平台已完成 Bootstrap，存在超管账号与 Gitea 后端。
4. CLI 已构建：`npm run build --workspace @esl/cli`，`esl` 可执行。

### 账号清单

| 角色 | 登录用户名 | 组织名 | 密码来源 |
| --- | --- | --- | --- |
| 超级管理员 | `eslroot` | 留空 | `.env` 中 `GITEA_ADMIN_PASSWORD` |
| 组织管理员 | `admin` | `<org>` | 开通/审批时下发的一次性初始密码 |
| 普通成员 | `<membername>` | `<org>` | 添加成员时指定或一次性生成 |

### 测试数据命名与隔离策略

- 所有 E2E 创建的实体使用唯一命名，避免与既有数据冲突：
  - 组织：`e2e<YYYYMMDDHHmmss>`（如 `e2e20260906153000`）
  - 成员：`mem<ts>`（如 `mem01`）
- 本特性用例会反复切换全局部署模式与默认组织，**用例结束必须恢复平台为 `multi` 模式且无默认组织**（或恢复到用例开始前的状态），避免污染其他测试。
- 破坏性用例（删除组织、切换到单组织冻结其他组织）只作用于本用例创建的 E2E 数据，严禁针对既有组织/成员执行。
- 平台设置变更（部署模式、默认组织）统一通过 `PUT /api/admin/orgs/settings` 以超管 token 调用；当前 Web 设置页（`SettingsView.vue`）尚未提供部署模式/默认组织的 UI，故设置类用例以 API 断言为主、Web 自适应为辅。

### 用例编号与优先级

- 编号前缀：`PLT-`（平台设置与 platform-info）、`LOGIN-`（登录契约 org 省略）、`GATE-`（单组织门禁）、`DEL-`（默认组织删除守卫）、`WEB-`（Web 自适应）、`BOOT-`（Bootstrap 单组织变体）、`REG-`（注册硬拒绝）、`CLI-`（CLI 登录自适应）、`NEG-`（负向/异常）。
- 优先级：`P0` 核心主流程（阻断性），`P1` 主要功能，`P2` 边界与次要。

---

## A. 平台设置与 platform-info（PLT）

### PLT-01　匿名 platform-info 初始状态（P0）

- **前置条件**：平台处于默认状态（`multi` 模式、无默认组织）。
- **测试数据**：无。
- **操作步骤**：
  1. 匿名请求 `GET /api/public/platform-info`（不带 Authorization）。
- **预期结果**：
  1. 返回 `200`，body 为 `{ "mode": "multi", "defaultOrg": null }`。
  2. 该端点无需认证，超管以外（无 token）也可访问。

### PLT-02　超管读取平台设置（P0）

- **前置条件**：超管已登录，持有超管 token。
- **操作步骤**：带超管 token 请求 `GET /api/admin/orgs/settings`。
- **预期结果**：
  1. 返回 `200`，body 包含 `orgRegistrationMode`、`deploymentMode`、`defaultOrg` 三个字段。
  2. 默认状态下 `deploymentMode: "multi"`、`defaultOrg: null`。

### PLT-03　设置默认组织（多组织模式下）（P0）

- **前置条件**：超管已登录；存在已开通组织 `<orgA>`。
- **测试数据**：`defaultOrg=<orgA>`。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings`，body `{ "defaultOrg": "<orgA>" }`。
  2. 再请求 `GET /api/public/platform-info`。
- **预期结果**：
  1. PUT 返回 `200`，body 中 `defaultOrg: "<orgA>"`、`deploymentMode: "multi"`。
  2. platform-info 返回 `{ "mode": "multi", "defaultOrg": "<orgA>" }`。
- **清理**：用例结束将 `defaultOrg` 置空（`PUT` body `{ "defaultOrg": null }`）。

### PLT-04　切换到单组织模式（原子切换：默认组织 + 模式同时生效）（P0）

- **前置条件**：超管已登录；存在已开通组织 `<orgA>`；当前为 `multi` 模式。
- **测试数据**：`deploymentMode=single`、`defaultOrg=<orgA>`。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings`，body `{ "deploymentMode": "single", "defaultOrg": "<orgA>" }`。
  2. 请求 `GET /api/public/platform-info`。
- **预期结果**：
  1. PUT 返回 `200`，`deploymentMode: "single"`、`defaultOrg: "<orgA>"` 同时生效。
  2. platform-info 返回 `{ "mode": "single", "defaultOrg": "<orgA>" }`。
- **注意**：从多组织切到单组织属于「原子切换」，**不需要** `confirm` 字段。
- **清理**：用例结束切回 `multi`。

### PLT-05　单组织模式下更换默认组织需显式确认（P0）

- **前置条件**：平台已为 `single` 模式，默认组织 `<orgA>`；存在另一个已开通组织 `<orgB>`。
- **测试数据**：`defaultOrg=<orgB>`，先不带 `confirm`，再带正确 `confirm`。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings`，body `{ "defaultOrg": "<orgB>" }`（不带 confirm）。
  2. 再请求 `PUT /api/admin/orgs/settings`，body `{ "defaultOrg": "<orgB>", "confirm": "<orgB>" }`。
- **预期结果**：
  1. 第一次返回 `400`，错误信息 `Reassigning the default org requires confirm matching the new organization name`；默认组织仍为 `<orgA>`。
  2. 第二次返回 `200`，`defaultOrg: "<orgB>"`；`<orgA>` 立即冻结、`<orgB>` 立即可登录。
- **清理**：用例结束恢复 `defaultOrg` 并切回 `multi`。

### PLT-06　切回多组织模式后默认组织设置保留（P1）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings`，body `{ "deploymentMode": "multi" }`（不带 defaultOrg）。
  2. 请求 `GET /api/public/platform-info`。
- **预期结果**：
  1. PUT 返回 `200`，`deploymentMode: "multi"`。
  2. platform-info 返回 `{ "mode": "multi", "defaultOrg": "<orgA>" }`（默认组织设置保留）。

### PLT-07　默认组织必须是已开通（active）组织（P1）

- **前置条件**：超管已登录；`<nonExistentOrg>` 不存在，或存在一个非 active 组织。
- **测试数据**：`defaultOrg=<nonExistentOrg>`。
- **操作步骤**：`PUT /api/admin/orgs/settings`，body `{ "defaultOrg": "<nonExistentOrg>" }`。
- **预期结果**：返回 `400`，错误信息 `defaultOrg must be an active organization`。

---

## B. 登录契约 — org 可省略按默认组织解析（LOGIN）

### LOGIN-01　Console 登录：设默认组织时组织管理员省略 org（P0）

- **前置条件**：平台设有默认组织 `<orgA>`（任意模式）；已知 `<orgA>` 组织管理员 `admin` 的密码。
- **测试数据**：`username=admin`、`org` 省略、`password=<admin 密码>`。
- **操作步骤**：`POST /api/console/login`，body `{ "username": "admin", "password": "..." }`（不含 org）。
- **预期结果**：
  1. 返回 `200`，`role: "org-admin"`、`org: "<orgA>"`。
  2. 实际登录的 Gitea 账号为 `<orgA>_admin`。

### LOGIN-02　Console 登录：设默认组织时 `eslroot` 省略 org 仍为超管（P0）

- **前置条件**：平台设有默认组织 `<orgA>`。
- **测试数据**：`username=eslroot`、`org` 省略、`password=<超管密码>`。
- **操作步骤**：`POST /api/console/login`，body 不含 org。
- **预期结果**：
  1. 返回 `200`，`role: "super"`、`org: null`。
  2. 不按默认组织解析（`eslroot` 不属于任何组织）。

### LOGIN-03　Console 登录：省略 org 且账号不属于默认组织被拒（P1）

- **前置条件**：平台设有默认组织 `<orgA>`；存在另一组织 `<orgB>` 的成员 `mem01`。
- **测试数据**：`username=mem01`、`org` 省略、`password=<mem01 密码>`。
- **操作步骤**：`POST /api/console/login`，body 不含 org。
- **预期结果**：
  1. 服务端按默认组织 `<orgA>` 解析为 `<orgA>_mem01`，该账号不存在或不属于 `<orgA>`。
  2. 返回 `401`（凭据无效）或 `403`（非该组织成员），不额外暴露跨组织信息。

### LOGIN-04　Console 登录：未设默认组织时非超管省略 org 被拒（P1）

- **前置条件**：平台 `defaultOrg: null`（多组织未设默认组织）。
- **测试数据**：`username=admin`、`org` 省略、密码任意。
- **操作步骤**：`POST /api/console/login`，body 不含 org。
- **预期结果**：返回 `403`，错误信息 `Only the platform administrator account may sign in without an organization`。

### LOGIN-05　CLI 登录：设默认组织时省略 org（P0）

- **前置条件**：平台设有默认组织 `<orgA>`；已知 `<orgA>` 成员账号密码。
- **测试数据**：`username=mem01`、`org` 省略。
- **操作步骤**：`POST /api/auth/login`，body `{ "username": "mem01", "password": "..." }`（不含 org）。
- **预期结果**：
  1. 返回 `200`，`role` 为 `member` 或 `org-admin`、`org: "<orgA>"`。
  2. 实际登录账号为 `<orgA>_mem01`。

### LOGIN-06　CLI 登录：未设默认组织时省略 org 被拒（P1）

- **前置条件**：平台 `defaultOrg: null`。
- **测试数据**：`username=mem01`、`org` 省略。
- **操作步骤**：`POST /api/auth/login`，body 不含 org。
- **预期结果**：返回 `400`，错误信息 `Organization, username and password are required`。

### LOGIN-07　CLI 登录：平台管理员账号被拒（P1）

- **前置条件**：任意。
- **测试数据**：`username=eslroot`、`org` 任意。
- **操作步骤**：`POST /api/auth/login`。
- **预期结果**：返回 `403`，错误信息 `Platform administrators sign in from the Admin Console`。

---

## C. 单组织门禁 — 冻结组织登录与存量 token 立即失效（GATE）

### GATE-01　单组织模式下默认组织成员可正常登录（P0）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`；已知 `<orgA>` 组织管理员密码。
- **操作步骤**：`POST /api/console/login`，`username=admin`、`org=<orgA>`（或省略）。
- **预期结果**：返回 `200`，`role: "org-admin"`，登录成功。

### GATE-02　单组织模式下非默认组织成员登录被拒（P0）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`；存在另一组织 `<orgB>` 及其成员 `mem01`。
- **测试数据**：`username=mem01`、`org=<orgB>`。
- **操作步骤**：`POST /api/console/login`（或 `/api/auth/login`）。
- **预期结果**：返回 `403`，错误信息 `Organization is frozen in single-organization mode`。

### GATE-03　单组织模式下冻结组织存量 token 立即失效（P0）

- **前置条件**：
  1. 平台先为 `multi` 模式，组织 `<orgB>` 成员 `mem01` 已登录并持有有效 token。
  2. 随后切换为 `single` 模式，默认组织 `<orgA>`（`<orgB>` 被冻结）。
- **操作步骤**：用 `<orgB>_mem01` 的 token 请求任一已认证路由（如 `GET /api/orgs/members`）。
- **预期结果**：返回 `403`，错误信息 `Organization is frozen in single-organization mode`（不等 token 自然过期）。

### GATE-04　单组织模式下超管不受影响（P0）

- **前置条件**：平台为 `single` 模式。
- **操作步骤**：超管 `eslroot` 登录并访问 `GET /api/admin/orgs`。
- **预期结果**：登录与访问均成功（`200`），超管不受单组织门禁限制。

### GATE-05　切回多组织后冻结组织登录与 token 立即恢复（P1）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`；`<orgB>` 处于冻结状态，其成员 token 此前被拒。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings`，body `{ "deploymentMode": "multi" }`。
  2. 用 `<orgB>_mem01` 的原 token 再次请求已认证路由。
  3. 用 `<orgB>_mem01` 重新登录。
- **预期结果**：
  1. 步骤 2 返回 `200`（token 恢复可用，组织资产未动）。
  2. 步骤 3 登录成功。

---

## D. 默认组织删除守卫与换默认确认（DEL）

### DEL-01　删除默认组织被阻止（P0）

- **前置条件**：平台设有默认组织 `<orgA>`（任意模式）；超管已登录。
- **操作步骤**：`DELETE /api/admin/orgs/<orgA>`，body `{ "confirm": "<orgA>" }`。
- **预期结果**：
  1. 返回 `409`，错误信息 `The default organization cannot be deleted; reassign the default org or switch to multi mode first`。
  2. 组织 `<orgA>` 未被删除。

### DEL-02　先更换默认组织后原默认组织可删除（P0）

- **前置条件**：平台默认组织 `<orgA>`；存在另一组织 `<orgB>`。
- **操作步骤**：
  1. 多组织模式下将默认组织改为 `<orgB>`（`PUT /api/admin/orgs/settings` body `{ "defaultOrg": "<orgB>" }`）。
  2. `DELETE /api/admin/orgs/<orgA>`，body `{ "confirm": "<orgA>" }`。
- **预期结果**：
  1. 步骤 1 返回 `200`。
  2. 步骤 2 返回 `200`/`202`，组织 `<orgA>` 被删除。
- **清理**：本用例自建组织执行，删除后无残留。

### DEL-03　先切回多组织后默认组织可删除（P1）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`；存在另一组织 `<orgB>` 用于承接（避免切回 multi 后 `<orgA>` 仍为默认组织导致删除失败的歧义，本步骤先把默认组织改到 `<orgB>` 或直接依赖 multi 下默认组织可删的语义）。
- **操作步骤**：
  1. `PUT /api/admin/orgs/settings` body `{ "deploymentMode": "multi" }`（此时默认组织仍为 `<orgA>`）。
  2. `DELETE /api/admin/orgs/<orgA>`，body `{ "confirm": "<orgA>" }`。
- **预期结果**：
  1. 步骤 1 返回 `200`。
  2. 步骤 2 仍返回 `409`（默认组织守卫不区分模式，只要是默认组织就拒绝删除）；需先将默认组织置空或改到其他组织，再删除 `<orgA>`。
- **注意**：默认组织守卫与部署模式无关，核心条件是「该组织是否为当前默认组织」。

### DEL-04　单组织模式下删除非默认（冻结）组织正常工作（P1）

- **前置条件**：平台为 `single` 模式，默认组织 `<orgA>`；存在冻结组织 `<orgB>`。
- **操作步骤**：`DELETE /api/admin/orgs/<orgB>`，body `{ "confirm": "<orgB>" }`。
- **预期结果**：返回 `200`/`202`，冻结组织 `<orgB>` 被正常删除（不受默认组织守卫影响）。
- **清理**：本用例自建组织执行。

---

## E. Web 登录与注册自适应（WEB）

### WEB-01　设默认组织（多组织）时登录页保留组织输入框（P1）

- **前置条件**：平台 `mode=multi`、`defaultOrg=<orgA>`。
- **操作步骤**：访问 `/admin/login`，等待 platform-info 加载完成。
- **预期结果**：
  1. 组织输入框（`data-test="org"`）可见。
  2. 注册入口（`data-test="register-link"`）可见。
- **说明**：多组织模式下即使设了默认组织也保留输入框（其他组织用户仍需填写）。

### WEB-02　单组织模式下登录页隐藏组织输入框与注册入口（P0）

- **前置条件**：平台 `mode=single`、`defaultOrg=<orgA>`。
- **操作步骤**：访问 `/admin/login`。
- **预期结果**：
  1. 组织输入框（`data-test="org"`）不存在（`v-if="!isSingleMode"`）。
  2. 注册入口（`data-test="register-link"`）不存在。
  3. 用户名（`data-test="username"`）与密码（`data-test="password"`）输入框可见。

### WEB-03　单组织模式下默认组织管理员登录成功（P0）

- **前置条件**：平台 `mode=single`、`defaultOrg=<orgA>`；已知 `<orgA>` admin 密码。
- **操作步骤**：
  1. 访问 `/admin/login`。
  2. 输入用户名 `admin`、密码，点击登录（`data-test="login-submit"`）。
- **预期结果**：
  1. 跳转到 `/admin/org/members`，出现「成员管理」。
  2. 请求 `POST /api/console/login` body 不含 org（或 org 为空），服务端按默认组织解析。

### WEB-04　多组织模式下登录页行为不变（P1）

- **前置条件**：平台 `mode=multi`、`defaultOrg=null`。
- **操作步骤**：访问 `/admin/login`。
- **预期结果**：组织输入框可见，超管可留空登录，组织用户需填写组织名（与现状一致）。

### WEB-05　单组织模式下注册页隐藏表单并提示（P0）

- **前置条件**：平台 `mode=single`。
- **操作步骤**：访问 `/admin/register`。
- **预期结果**：
  1. 注册表单（`el-form`）不渲染（`v-if="!isSingleMode"`）。
  2. 出现单组织模式提示（`data-test="single-mode-notice"`），文案为「平台处于单组织模式，不接受新的组织注册申请。」。
  3. 返回登录链接（`data-test="back-to-login"`）可见。

### WEB-06　多组织模式下注册页行为不变（P1）

- **前置条件**：平台 `mode=multi`。
- **操作步骤**：访问 `/admin/register`。
- **预期结果**：注册表单正常渲染，可提交组织注册申请（与现状一致）。

---

## F. Bootstrap 单组织变体（BOOT）

> 本组用例涉及修改环境变量并重启服务，需在独立的 Docker 栈或测试环境中执行，避免污染主栈。

### BOOT-01　单组织声明下 Bootstrap 自动开通默认组织（P0）

- **前置条件**：干净的数据卷（`docker compose down -v`）；`.env` 设置 `ESL_DEPLOYMENT_MODE=single`、`ESL_DEFAULT_ORG=<orgA>`、`ESL_ORG_ADMIN_PASSWORD=<密码>`，其余必填项齐全。
- **操作步骤**：
  1. `docker compose up -d` 启动。
  2. 等待 `api` healthy。
  3. 请求 `GET /api/public/platform-info`。
  4. 用 `<orgA>` admin 登录（`POST /api/console/login`，`username=admin`、`org` 省略）。
- **预期结果**：
  1. platform-info 返回 `{ "mode": "single", "defaultOrg": "<orgA>" }`。
  2. 组织 `<orgA>` 已开通（`GET /api/admin/orgs` 含 `<orgA>`）。
  3. `admin` 可登录，`role: "org-admin"`。

### BOOT-02　单组织模式缺失必填环境变量启动报错（P0）

- **前置条件**：`.env` 设置 `ESL_DEPLOYMENT_MODE=single`，但缺少 `ESL_DEFAULT_ORG` 或 `ESL_ORG_ADMIN_PASSWORD`。
- **操作步骤**：尝试启动服务。
- **预期结果**：
  1. 服务启动失败，日志含清晰错误（`ESL_DEFAULT_ORG is required` 或 `ESL_ORG_ADMIN_PASSWORD is required`，或 `Invalid ESL_DEPLOYMENT_MODE`）。
  2. 不进入服务就绪状态。

### BOOT-03　默认 multi 时不触发自动建组织（P1）

- **前置条件**：干净数据卷；`.env` 未设 `ESL_DEPLOYMENT_MODE`（默认 `multi`），不设 `ESL_DEFAULT_ORG`。
- **操作步骤**：启动服务后请求 `GET /api/public/platform-info`。
- **预期结果**：返回 `{ "mode": "multi", "defaultOrg": null }`；无自动创建的组织。

### BOOT-04　Bootstrap Reset 后按 .env 声明重新初始化（P1）

- **前置条件**：已按 BOOT-01 以 single 模式 Bootstrap 出 `<orgA>`。
- **操作步骤**：
  1. 执行 Bootstrap Reset（清数据卷）。
  2. 保持 `.env` 为 single 模式声明，重启。
  3. 请求 platform-info。
- **预期结果**：重新以 single 模式 + `<orgA>` 默认组织初始化，platform-info 返回 `{ "mode": "single", "defaultOrg": "<orgA>" }`。

### BOOT-05　部署后可经管理 API 将单组织切回多组织（P1）

- **前置条件**：BOOT-01 已完成（single 模式，默认 `<orgA>`）。
- **操作步骤**：超管 `PUT /api/admin/orgs/settings` body `{ "deploymentMode": "multi" }`。
- **预期结果**：返回 `200`，`deploymentMode: "multi"`；模式非终身判决，可双向切换。

---

## G. 注册硬拒绝与挂起申请保持（REG）

### REG-01　单组织模式下提交注册申请被拒（P0）

- **前置条件**：平台 `mode=single`。
- **测试数据**：`orgName=e2e<ts>`、`password=<合法密码>`。
- **操作步骤**：`POST /api/orgs/apply`，body `{ "orgName": "e2e<ts>", "password": "..." }`。
- **预期结果**：返回 `403`，错误信息 `Organization registration is disabled in single-organization mode`。

### REG-02　切换到单组织时已存在的待审批申请保持 pending（P1）

- **前置条件**：
  1. 平台 `mode=multi`、注册模式 `manual`。
  2. 提交一条注册申请得到 `pending` 状态（记录其 id）。
- **操作步骤**：
  1. 切换到 `single` 模式。
  2. `GET /api/admin/orgs/applications` 查看该申请状态。
- **预期结果**：该申请仍为 `pending`，未被自动拒绝或删除。

### REG-03　切回多组织后挂起申请可继续审批（P1）

- **前置条件**：REG-02 中的 pending 申请仍在；平台当前为 `single`。
- **操作步骤**：
  1. 切回 `multi` 模式。
  2. 超管批准该申请（`POST /api/admin/orgs/applications/<id>/approve`）。
- **预期结果**：批准成功，组织开通完成（与既有审批流程一致）。

### REG-04　多组织模式下注册申请流程不变（P1）

- **前置条件**：平台 `mode=multi`、注册模式 `auto`。
- **操作步骤**：`POST /api/orgs/apply` 提交合法注册。
- **预期结果**：返回 `201 { status: "approved" }`，组织开通（与既有行为一致）。

---

## H. CLI 登录按 platform-info 自适应（CLI）

### CLI-01　设默认组织时 `esl login` 不询问组织名（P0）

- **前置条件**：平台 `defaultOrg=<orgA>`；本地无残留 config（或使用独立 `--home`）。
- **操作步骤**：
  1. 执行 `esl login --username mem01`（交互式输入密码）。
  2. 观察是否出现组织名提示。
- **预期结果**：
  1. 不出现 `Organization:` 提示，直接按默认组织 `<orgA>` 登录。
  2. 登录成功，本地 config 中 `org` 记录为 `<orgA>`。

### CLI-02　设默认组织时 `--org` 显式覆盖（P0）

- **前置条件**：平台 `defaultOrg=<orgA>`；存在另一组织 `<orgB>` 及其成员 `mem01`。
- **操作步骤**：`esl login --org <orgB> --username mem01`。
- **预期结果**：按 `<orgB>` 登录成功（不使用默认组织），本地 config 中 `org` 为 `<orgB>`。

### CLI-03　多组织未设默认组织时必须填写组织名（P1）

- **前置条件**：平台 `defaultOrg=null`。
- **操作步骤**：交互式执行 `esl login --username mem01`。
- **预期结果**：出现 `Organization:` 提示，必须输入组织名才能继续（与现状一致）。

### CLI-04　`--no-input` 有默认组织时无需 `--org`（P1）

- **前置条件**：平台 `defaultOrg=<orgA>`。
- **操作步骤**：`esl login --no-input --username mem01 --password-file <path>`。
- **预期结果**：登录成功，无需 `--org`，按默认组织 `<orgA>` 解析。

### CLI-05　`--no-input` 无默认组织且无 `--org` 报错（P1）

- **前置条件**：平台 `defaultOrg=null`。
- **操作步骤**：`esl login --no-input --username mem01 --password-file <path>`（不带 `--org`）。
- **预期结果**：命令失败，错误信息 `An organization is required; pass --org or run interactively`。

### CLI-06　platform-info 不可用时回退到原交互（P2）

- **前置条件**：platform-info 端点不可达（如服务未就绪或网络异常）。
- **操作步骤**：交互式执行 `esl login --username mem01`。
- **预期结果**：不阻断登录，回退到询问组织名（`Organization:` 提示）；认证失败本身由登录接口给出错误。

---

## I. 负向/异常用例（NEG）

### NEG-01　切换到单组织未携带默认组织被拒（P0）

- **前置条件**：平台 `multi` 模式、无默认组织。
- **操作步骤**：`PUT /api/admin/orgs/settings` body `{ "deploymentMode": "single" }`（不带 defaultOrg）。
- **预期结果**：返回 `400`，错误信息 `single mode requires a default org`。

### NEG-02　非法 deploymentMode 值被拒（P1）

- **操作步骤**：`PUT /api/admin/orgs/settings` body `{ "deploymentMode": "invalid" }`。
- **预期结果**：返回 `400`，错误信息 `deploymentMode must be single or multi`。

### NEG-03　单组织换默认组织 confirm 不匹配被拒（P1）

- **前置条件**：平台 `single` 模式，默认 `<orgA>`；存在 `<orgB>`。
- **操作步骤**：`PUT /api/admin/orgs/settings` body `{ "defaultOrg": "<orgB>", "confirm": "wrong" }`。
- **预期结果**：返回 `400`，错误信息 `Reassigning the default org requires confirm matching the new organization name`；默认组织不变。

### NEG-04　删除默认组织 confirm 正确仍被拒（P1）

- **前置条件**：默认组织 `<orgA>`。
- **操作步骤**：`DELETE /api/admin/orgs/<orgA>` body `{ "confirm": "<orgA>" }`。
- **预期结果**：返回 `409`（默认组织守卫优先于 confirm 校验），组织未删除。

### NEG-05　非法 ESL_DEPLOYMENT_MODE 启动报错（P1）

- **前置条件**：`.env` 设置 `ESL_DEPLOYMENT_MODE=invalid`。
- **操作步骤**：启动服务。
- **预期结果**：启动失败，日志含 `Invalid ESL_DEPLOYMENT_MODE: invalid`。

---

## 执行顺序与回归策略

1. 推荐按 `PLT → LOGIN → GATE → DEL → WEB → REG → CLI → NEG` 顺序执行；`BOOT` 组涉及环境变量与数据卷重置，建议在独立栈中单独执行，不与上述用例共享状态。
2. **全局状态恢复约定**：本特性用例频繁修改 `deployment_mode` 与 `default_org`，每条用例结束必须执行恢复步骤：
   - 切回 `multi`：`PUT /api/admin/orgs/settings` body `{ "deploymentMode": "multi" }`
   - 清空默认组织：`PUT /api/admin/orgs/settings` body `{ "defaultOrg": null }`
   确保后续用例从干净的 `multi + 无默认组织` 状态开始。
3. 破坏性用例（DEL-02/03/04、REG-01 不产生数据）只对用例自建组织执行；切换单组织冻结其他组织时，仅使用本用例创建的 E2E 组织。
4. `GATE` 组用例依赖先在多组织下登录获取 token，再切换单组织验证失效，注意 token 与组织的对应关系。
5. `WEB` 组依赖前端已重新部署（platform-info 自适应逻辑在前端构建产物中）。
6. 若 Docker 栈被重建，需重新 Bootstrap；BOOT 组用例需在干净数据卷上执行。

---

## 更新摘要

| 日期 | 版本 | 核心变更 |
| --- | --- | --- |
| 2026-09-06 | v1.0 | 初版：覆盖平台设置与 platform-info（PLT-01~07）、登录契约 org 省略（LOGIN-01~07）、单组织门禁（GATE-01~05）、默认组织删除守卫（DEL-01~04）、Web 登录/注册自适应（WEB-01~06）、Bootstrap 单组织变体（BOOT-01~05）、注册硬拒绝与挂起申请（REG-01~04）、CLI 登录自适应（CLI-01~06）、负向用例（NEG-01~05）；确立全局状态恢复约定（multi + 无默认组织）。 |
