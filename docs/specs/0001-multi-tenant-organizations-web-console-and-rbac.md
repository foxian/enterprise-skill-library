# Spec: 多租户组织、Vue Web 管理后台与 RBAC 权限体系

## Problem Statement

在现有的单一平台组织（Platform Organization）模型下，企业技能库面临以下痛点：
1. **租户隔离缺失**：无法在多企业、多部门或跨租户场景下实现技能、成员与源码的强隔离。
2. **缺乏可视化管理后台**：组织申请、账号管理、团队配置完全依赖 CLI，非技术人员与组织管理者缺乏直观的操作界面。
3. **权限控制粗粒度**：技能发布后全平台可见或无法精细化按团队、按个人分配使用（下载）与协作（编辑）权限。
4. **管理与开发者操作混杂**：平台运维命令、管理员命令与普通开发者 CLI 命令耦合在一起，职责边界不清晰。

## Solution

1. **多租户体系与 Gitea 映射**：
   - 每一个 Tenant Organization 映射为一个 Gitea Organization。
   - Skill Identity 中的 `@scope/skill-name` 的 `scope` 绑定组织名（`@<orgname>/<skill-name>`）。
   - 组织间数据与仓库完全隔离。
2. **Vue 3 Web 管理后台**：
   - 新增 `packages/web` 前端项目，构建为静态资源由 Nginx 在 `/admin` 统一托管。
   - 提供公开组织申请页（支持超管免审直通与人工审批两种模式）。
   - 组织管理员登录后台管理组织成员（`<orgname>_<username>`）、自定义团队（Read/Write 级别）与技能权限矩阵。
   - 平台超级管理员（`eslroot`）登录后台审批组织申请、配置平台策略与全局治理。
   - 普通成员可登录后台或通过 CLI 管理自己创建技能的共享授权。
3. **精细化 RBAC 权限体系**：
   - 每个组织默认配备 `all-readers`（全员只读）与 `all-writers`（全员协作）团队，新成员自动加入。
   - 技能权限矩阵支持：仅创建者可见、全员可用、全员协作、指定团队可用/可编、指定成员（Collaborator）可用/可编。
4. **CLI 职责纯粹化**：
   - 移除所有管理员远程管理命令（`esl admin user create`, `esl delete` 等）。
   - 保留并增强面向开发者的命令（`login --org`, `share`, `upload`, `publish`, `install` 等）。

---

## User Stories

### 组织申请与平台超级管理员管理

1. 作为未注册企业代表，我想要在 Web 页面上提交组织注册申请（包含组织名、管理员名称与密码），以便为我的企业或部门建立独立的技能空间。
2. 作为未注册企业代表，我想要在提交组织申请时获得实时的组织名合规性校验（如长度、禁止下划线、系统保留字），以便避免提交无效的申请。
3. 作为平台超级管理员，我想要在后台配置"组织注册是否需要审批"，以便灵活适应内部快速开放或严格管控的运营策略。
4. 作为平台超级管理员，当系统配置为需要审批时，我想要在 Web 控制台查看所有待审批的组织申请列表及其详细信息，以便进行审核。
5. 作为平台超级管理员，我想要能够批准或拒绝某个组织申请；批准后系统应自动完成 Gitea 组织与 `<orgname>_admin` 管理账号的初始化。
6. 作为平台超级管理员，当系统配置为免审批时，用户的组织申请被提交后能够即时自动完成初始化，以便提升开通效率。
7. 作为平台超级管理员，我想要在 Web 控制台查看全平台的组织列表、成员规模及技能数量，以便掌握平台整体使用情况。
8. 作为平台超级管理员，我想要能够在确认后彻底删除某个组织及其所有关联技能和成员，以便清理违规或废弃租户。

### 组织管理员管理

9. 作为组织管理员，我想要通过 Web 登录界面使用组织管理员账号登录，以便进入我所在组织的管理控制台。
10. 作为组织管理员，我想要在组织后台添加新成员账号（设置用户名与初始密码），以便让组织内的开发者加入平台。
11. 作为组织管理员，我想要在组织后台重置成员密码或禁用离职成员，以便维护组织内部的信息安全。
12. 作为组织管理员，我想要在组织后台创建自定义团队（如 `frontend`、`backend`）并为团队指定访问权限级别（Read 或 Write），以便按业务部门划分权限。
13. 作为组织管理员，我想要在团队中添加或移除成员，以便调整团队的人员结构。
14. 作为组织管理员，我想要查看组织内所有技能列表及其当前的权限共享状态，以便进行组织资产治理。
15. 作为组织管理员，我想要能够为组织内任意技能调整共享权限（全员/团队/个人），以便接管或协调技能的流通范围。

### 组织成员与开发者操作

16. 作为组织普通成员，我想要使用我的用户名、组织名及密码登录 Web 控制台，以便查看和管理我创建的技能。
17. 作为组织普通成员，我想要在 CLI 中通过 `esl login --org <orgname>` 登录，以便在终端中开展技能开发工作。
18. 作为组织普通成员，我想要通过 `esl upload` 首次提交技能源码，系统应自动在组织命名空间下创建技能仓库，默认仅我自己可见。
19. 作为组织普通成员，我想要在 Web 控制台或通过 CLI `esl share` 将我的技能共享给组织内全员使用（下载），以便推广我的技能成果。
20. 作为组织普通成员，我想要在 Web 控制台或通过 CLI `esl share` 将我的技能共享给组织内全员协作（编辑），以便让组织所有人共同维护源码。
21. 作为组织普通成员，我想要将我的技能仅授权给特定团队（如 `frontend`）使用或编辑，以便仅在小范围内协作。
22. 作为组织普通成员，我想要将我的技能单独授权给特定成员个人使用或编辑，以便进行精准点对点协作。
23. 作为组织普通成员，我想要通过 `esl search` 检索技能，结果中只包含我所在组织内我有权访问的技能，以便避免信息泄露与混乱。
24. 作为组织普通成员，我想要通过 `esl install @orgname/skill-name` 安装我有权访问的技能，无权限时应被明确拒绝。
25. 作为组织普通成员，我想要通过 `esl source @orgname/skill-name` 检出我有协作权限的技能源码，以便拉取代码进行修改。
26. 作为组织普通成员，我想要在完成源码修改后通过 `esl publish` 发布新版本，前提是我对该技能拥有编辑（Write）权限。

---

## Implementation Decisions

### 1. 模块边界与架构划分
- **Web 前端 (`packages/web`)**: 采用 Vue 3 + Vite + Pinia + Vue Router + Element Plus 构建的 SPA 应用，构建静态产物交由统一 Nginx 容器代理托管在 `/admin` 路径。
- **服务端 API (`packages/server`)**: 在现有 Fastify 架构下扩展组织、审批流、团队及技能 RBAC 路由；封装 Gitea 组织与协作者 API。
- **客户端 CLI (`packages/cli`)**: 移除 `esl admin` 远程管理子命令；重构 `esl login` 支持 `--org`；新增 `esl share` 授权命令。
- **核心包 (`packages/core`)**: 升级技能命名解析器，确保 `@scope/skill-name` 严格校验组织名作为 scope。

### 2. Gitea 深度映射与数据同步
- **组织初始化**：创建 Gitea Organization，创建 `<orgname>_admin` 用户并设为 Org Owner，创建 `all-readers` (repo_units: read) 与 `all-writers` (repo_units: write) 默认团队。
- **成员账号体系**：Gitea 账号名采用 `<orgname>_<username>`。Web 与 CLI 界面支持分离输入，后端自动组装。
- **成员入组同步**：后台添加成员时，自动将其加入 `all-readers` 与 `all-writers` 团队。
- **权限授予机制**：
  - 团队授权：调用 Gitea Team Repo API 将技能仓库挂载到对应 Team。
  - 个人授权：调用 Gitea Collaborator API 将成员添加为仓库的只读或读写协作者。

### 3. API 契约设计

| 路由 | 方法 | 鉴权角色 | 描述 |
|---|---|---|---|
| `/api/orgs/apply` | `POST` | 公开 | 提交组织注册申请 |
| `/api/admin/orgs/applications` | `GET` | 超级管理员 | 获取待审批申请列表 |
| `/api/admin/orgs/applications/:id/approve` | `POST` | 超级管理员 | 批准组织注册申请 |
| `/api/admin/orgs/applications/:id/reject` | `POST` | 超级管理员 | 拒绝组织注册申请 |
| `/api/admin/orgs/settings` | `GET/PUT` | 超级管理员 | 获取/更新平台注册审批策略（auto/manual） |
| `/api/admin/orgs` | `GET` | 超级管理员 | 获取所有组织列表 |
| `/api/admin/orgs/:orgName` | `DELETE` | 超级管理员 | 删除指定组织（需确认） |
| `/api/orgs/members` | `GET/POST` | 组织管理员 | 查询/添加组织成员 |
| `/api/orgs/members/:username/disable` | `POST` | 组织管理员 | 禁用组织成员 |
| `/api/orgs/members/:username/password` | `POST` | 组织管理员 | 重置成员密码 |
| `/api/orgs/teams` | `GET/POST` | 组织管理员 | 查询/创建自定义团队 |
| `/api/orgs/teams/:teamId/members` | `POST/DELETE`| 组织管理员 | 团队成员绑定/解绑 |
| `/api/skills/:scope/:skillName/permissions` | `GET/POST` | Owner/Org Admin/Member | 查询/更新技能权限分配矩阵 |

---

## Testing Decisions

### 1. 测试标准与原则
- **外部行为优先**：测试均聚焦于 HTTP API 输入/输出、CLI 退出码与 stdout 输出、Web 组件交互与状态，不依赖内部私有变量。
- **高测试接缝（High Seams）**：
  - 服务端：采用 Fastify `app.inject()` 进行端到端 API 测试，配合 Gitea Mock Client 校验组织/团队/仓库权限调用。
  - CLI 端：采用命令行执行入口集成测试，注入 Mock HTTP Fetch 校验参数构造与错误处理。
  - 前端：采用 Vitest + Vue Test Utils 对登录视图、申请视图、组织管理与技能权限视图进行组件与状态测试。

### 2. 核心测试用例集
- `packages/server/tests/org-lifecycle.test.ts`: 测试申请 → 审批（或免审）→ 自动创建 Gitea 组织、管理员、默认团队的全链路。
- `packages/server/tests/rbac-permissions.test.ts`: 测试技能全员可见、团队可见、个人可见对应的 Gitea Team/Collaborator 同步逻辑与搜索过滤。
- `packages/cli/tests/login-multi-org.test.ts`: 测试 `esl login --org <org>` 参数解析与 token 存储。
- `packages/cli/tests/share.test.ts`: 测试 `esl share` 命令在各种组合参数（`--all`, `--team`, `--user`, `--write`）下的请求调用。

---

## Out of Scope

1. **多组织联合搜索与跨组织共享**：本期组织间完全隔离，不提供跨组织技能发现与安装。
2. **Web 端富文本/Markdown 技能编辑器**：本期 Web 后台仅负责资产与权限治理，技能源码创建与发布仍通过 CLI 完成。
3. **邮件/短信审批通知系统**：申请状态直接在 Web 页面查询，本期不集成第三方消息通道。
4. **历史单组织数据向多租户的兼容迁移脚本**：确立为全新架构升级，不提供向后数据迁移。

---

## Further Notes

- 关联 ADR：`docs/adr/0016-multi-tenant-organizations-web-console-and-rbac.md`。
- 领域词汇：已同步更新至根目录 `CONTEXT.md`。
