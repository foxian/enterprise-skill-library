# 多租户组织、Web管理后台与RBAC权限模型

Status: accepted

ESL 架构从原有的"单一平台组织（Platform Organization）+ CLI 管理"升级为"多组织（多租户）、Vue Web 管理后台 + RBAC 组织内协作权限模型"。原有面向平台管理员的 CLI 远程管理命令全部移除，统一收敛至 Web 管理后台；CLI 仅保留面向开发者的技能消费与协作开发功能。

## 背景与动因

1. **企业多租户诉求**：单一 Platform Organization 无法满足多企业/多租户/大部门间完全隔离的需求。
2. **可视化管理诉求**：组织注册、成员增删、团队划分、权限矩阵配置在 CLI 中操作繁琐，需要可视化的 Web 后台（Vue 3 + Node.js API）。
3. **精细化技能权限**：技能需要支持仅自己可见、组织全员使用、组织全员协作、指定团队可用/可编、指定成员可用/可编等灵活的权限粒度。

## 核心架构决策

### 1. 多租户组织与 Gitea 映射
- **组织映射**：ESL 中的每个组织直接映射为底层 Gitea 的一个 Organization。
- **作用域（Scope）**：技能标识 `@scope/skill-name` 的 `scope` 段直接对应组织名（`@<orgname>/<skill-name>`）。
- **完全隔离**：组织间数据与技能完全私有隔离，不支持跨组织直接检索与安装。
- **组织命名规则**：仅允许小写字母、数字和连字符 `-`，长度 2-39 字符，禁止包含下划线 `_`，保留系统关键字（`admin`、`api`、`git`、`system`、`local`、`builtin` 等）。

### 2. 账号体系与命名规范
- **超级管理员**：`eslroot`，脱离于具体组织之外，具备全局平台管理视角与治理兜底权。
- **组织管理账号**：格式为 `<orgname>_admin`，映射为 Gitea 对应 Organization 的 Owner 角色，拥有组织内成员、团队及全部技能的最高管理权。
- **组织成员账号**：格式为 `<orgname>_<username>`。在 Web 登录及 CLI 操作中，用户输入"用户名 + 组织名"，系统自动组装为底层的 Gitea 用户名。
- **单组织归属**：一个成员仅归属于单一组织。

### 3. 组织注册与审批流
- **申请入口**：Web 登录页提供公开的"注册组织"入口，申请人填写组织名、管理员显示名及初始密码。
- **审批模式配置**：超级管理员可在后台全局配置"免审批自动通过"或"需超级管理员审批"。
- **初始化创建**：审批通过（或免审通过）后，后端自动在 Gitea 创建 Organization、创建 `<orgname>_admin` 账号并将其设为 Owner，同时创建两个默认全员团队：
  - `all-readers` (Read 权限)：用于技能全组织下载与使用。
  - `all-writers` (Write 权限)：用于技能全组织协作编辑。

### 4. 团队与技能权限体系 (RBAC)
- **新成员入组**：组织管理员在后台添加新成员时，系统自动将其加入 `all-readers` 与 `all-writers` 团队。
- **自定义团队**：组织管理员可自由创建自定义团队（如 `frontend`、`devops`），并指定团队权限级别（Read 或 Write）。
- **技能权限粒度**：
  - **默认状态**：仅技能创建者（Owner）可见可编。
  - **全员可用**：将技能仓库关联至 `all-readers` 团队。
  - **全员协作**：将技能仓库关联至 `all-writers` 团队。
  - **指定团队权限**：将技能仓库关联至目标自定义团队（继承该团队的 Read 或 Write 属性）。
  - **指定成员权限**：通过 Gitea Collaborator API 直接将目标用户添加为仓库协作者（赋予 Read 或 Write）。
- **权限管理入口**：
  - **Web 后台**：组织管理员及技能创建者均可登录后台管理技能权限矩阵。
  - **CLI 命令**：提供 `esl share` 系列命令，支持开发者在命令行快速共享与授权。

### 5. CLI 与 Web 后台职责分离
- **废弃 CLI 管理命令**：移除 `esl admin user create`、`esl admin user disable`、`esl admin user set-password`、`esl admin user token`、`esl admin account change-password`、`esl delete` 等远程管理员命令。
- **保留 CLI 开发者命令**：`init`, `login`（支持 `--org`）, `whoami`, `upload`, `publish`, `install`, `update`, `uninstall`, `info`, `search`, `source`, `use`, `adapt`, `list`, `share`, `account change-password`（修改自身密码）。
- **Web 前端架构**：基于 Vue 3 SPA（置于 `packages/web`），构建生成静态资源由统一入口 Nginx 进行托管。
- **Web 后端架构**：在 `packages/server` 中扩展组织、团队、审批流与权限路由，统一通过 Fastify 提供 API。

## 影响与后果 (Consequences)

1. **废弃单一组织 ADR-0007 中的固定 Namespace 假设**，Skill Scope 正式多租户化。
2. **安全性与隔离性大幅增强**：企业间技能与源码完全隔离。
3. **前后端架构升级**：引入 `packages/web`，构建与部署流程集成前端编译。
