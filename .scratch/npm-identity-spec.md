# Spec: npm 式身份模型重构（全局用户 / 多组织 / 扁平命名空间 / release.json v3）

> 设计共识见 #48，术语表见 `CONTEXT.md`（已按目标模型重写），决定记录见 ADR-0032。本 spec 按 ADR-0032 的术语行文。

## Problem Statement

今天一个"用户"只是某个组织内部的账号（`<组织>_<用户名>`）：跨组织就要多个互不相通的账号，登录要先选组织，一个人无法既发个人技能又发组织技能。组织只能靠申请-审批-异步开通创建，组织之间完全私有隔离，平台内没有公开技能共享的可能。技能归属由 git remote 路径隐式决定，release.json 里不写身份，归属从不可见、不可声明。

## Solution

改为 npm 式模型：任何人可在平台注册全局账号，注册即得个人命名空间 `@用户名`。一个用户可创建多个组织、被拉入多个组织；发布技能时在 release.json 的 `name` 字段里声明归属（`@org/skill` 或无 scope 的个人归属），首次上传时固定身份。组织内有四个常设团队承担批量授权，技能可见性逐技能设 public（平台全员可搜可装）/ private（默认，仅被授权者）。组织与用户名共享一个先到先得的扁平命名池。

## User Stories

### 注册与登录

1. 作为访客，我想在平台自助注册账号（用户名 + 密码），以便无需管理员介入就能开始使用技能库
2. 作为访客，我想注册时被告知用户名已被占用或属于保留名，以便换一个名字而不是注册失败后不明所以
3. 作为访客，我想在 `registration_mode: approval` 模式下提交注册后收到"待审批"状态，以便了解为什么还不能登录
4. 作为 Super Administrator，我想切换 `registration_mode`（open / approval），以便控制平台开放程度
5. 作为 Super Administrator，我想在 approval 模式下审批或拒绝注册申请，以便把关谁能进入平台
6. 作为 Skill User，我想只用用户名和密码登录（不再选择组织），以便一条凭据走遍我所在的个人空间和所有组织
7. 作为 Skill User，我想注册成功后自动拥有个人命名空间 `@我的用户名`，以便立即能发布个人技能而无需任何申请

### 组织创建与加入

8. 作为 Skill User，我想在 `org_registration_mode: auto` 下即时创建组织（我成为组织管理员），以便马上以组织名义发布技能
9. 作为 Skill User，我想创建多个组织，以便隔离不同团队/产品线的技能
10. 作为 Skill User，我想创建组织时被告知组织名已被占用（组织、用户或保留名），以便当场换名
11. 作为 Skill User，我想在 `manual` 模式下提交组织注册申请并看到待审状态，以便走企业审批流程
12. 作为 Skill User，我想提交组织申请时即被告知同名组织已存在或已有同名待审申请，以便冲突不会拖到审批那一刻才暴露
13. 作为 Super Administrator，我想拒绝一份组织申请并因此释放它占用的名字，以便名字池不被僵死申请卡住
14. 作为 Super Administrator，我想审批通过组织申请后组织立即可用（申请人成为组织管理员），以便不等待任何异步开通
15. 作为 Super Administrator，我想切换 `org_registration_mode`（auto / manual），以便按企业治理要求决定组织是自助还是审批制
16. 作为 Super Administrator，我想切换拉人方式（邀请制 / 直接添加），以便按安全要求决定成员进组织是否需要本人确认
17. 作为 Organization Admin，我想（直接添加模式下）把已注册用户加入组织，以便扩充团队
18. 作为 Organization Admin，我想（邀请制模式下）发出邀请、由对方接受后入组，以便成员知情同意地获得组织权限
19. 作为 Skill User，我想被加入组织后自动出现在组织的只读、读写、技能管理三个常设团队里，以便组织内的授权共享立即对我生效
20. 作为 Skill User，我想离开组织（被移出或主动退出）后自动从这三个常设团队移出，以便权限随身份即时回收
21. 作为 Skill User，我想看到我所属的全部组织列表，以便在多个组织间切换工作上下文

### 团队与组织治理

22. 作为 Organization Admin，我想创建、改名、删除自定义团队并设定其技能访问级别（Read / Write / Manage），以便按项目组批量授权
23. 作为 Organization Admin（Owners 团队的任何成员，不只是创建者），我想管理成员与团队，以便组织治理不依赖单点
24. 作为 Organization Admin，我想常设团队（只读/读写/技能管理/管理员）不可删除、不可改名，以便授权载体稳定不被误伤
25. 作为 Organization Admin，我想可见并管理本组织名下全部技能，以便对失联或违规技能有治理兜底

### 技能创建与归属声明

26. 作为 Skill User，我想 `esl init` 时 release.json 自动带上默认 `name`（`@我的用户名/技能名`），以便个人技能零配置就能发布
27. 作为 Skill User，我想把 release.json 的 `name` 改写为 `@我的组织/技能名`，以便把技能发布到组织命名空间
28. 作为 Skill User，我想显式写 `@自己的用户名/技能名` 与不写 scope 等价，以便归属表达统一、无二义
29. 作为 Skill User，我想首次 `esl upload` 时服务器按 release.json 的 `name` 创建 Git 仓库并固定技能身份，以便归属在技能诞生时就确定
30. 作为 Skill User，我想上传到组织命名空间时被校验是组织成员，以便外人不能在我的组织下抢注技能名
31. 作为 Skill User（组织成员），我想上传新技能到组织命名空间并自动成为该技能的初始 Maintainer，以便不需要组织管理员预授权
32. 作为 Skill User，我想 release.json v2（无 name 字段）在发布时被拒绝并得到升级指引，以便旧清单不会静默产生归属不明技能
33. 作为 Maintainer，我想 `esl publish` 时服务器断言 release.json 的 `name` 与技能既定身份一致，不一致即报错，以便一次笔误不会把技能发到别的命名空间
34. 作为 Skill User，我想保留名（`local`、`builtin`、`admin`、`api`、`git`、`system`）不能被用作用户名或组织名，以便保留 scope 与系统路径永远可用

### 可见性与授权

35. 作为 Maintainer 或 Organization Admin，我想把技能设为 public，以便平台内所有用户都能搜到并安装它
36. 作为 Maintainer 或 Organization Admin，我想把技能设为 private（默认），以便只有被授权者可见
37. 作为 Skill User，我想搜索结果跨命名空间包含所有我有权看到的技能（public + 被授权的 private），以便发现组织外的公开技能
38. 作为 Skill User（A 组织成员），我想默认看不到 A 组织 private 技能（除非被授权），以便组织默认零信任、授权显式
39. 作为 Organization Admin，我想把一个技能授权给组织只读团队（= 全员可读），以便一次操作完成组织内共享
40. 作为 Organization Admin，我想把技能授权给组织读写团队或技能管理团队，以便按级别批量放开协作或管理
41. 作为 Maintainer，我想逐技能添加/移除团队与成员授权（Read / Write / Manage），以便精确控制协作面
42. 作为 Skill User，我想安装其他组织的 public 技能，以便复用平台共享成果
43. 作为 Skill User，我想安装 private 技能被拒时有清晰的"无权限"错误，以便知道该向谁申请授权
44. 作为 Skill User，我想 public 技能可以被声明为依赖并被锁定解析，以便跨组织技能可以互相组合

### 改名与稳定性

45. 作为 Maintainer，我想在命名空间内给技能改名（短名），旧身份 301 重定向、已安装用户得到迁移提示，以便纠错而不破坏消费者
46. 作为平台使用者，我想用户名和组织名永远不可改名，以便 `@scope` 引用（依赖声明、锁文件、文档）永久有效
47. 作为 Skill User，我想跨命名空间移动技能被拒绝并得到明确错误，以便归属变更必须走显式流程而非顺手操作

### 控制台与 CLI

48. 作为 Skill User，我想在 Web 个人中心看到跨命名空间聚合的"我的技能"（个人 + 所有组织，标注 managed/shared），以便一眼掌握全部资产
49. 作为 Organization Admin，我想在组织页管理成员与团队，以便治理操作集中
50. 作为 Super Administrator，我想在超管控制台处理注册审批、组织申请审批和平台设置，以便行使平台治理权
51. 作为 Skill User，我想 CLI 登录后 `whoami`/`status` 显示我的全局身份与所属组织列表，以便确认当前会话状态
52. 作为 Skill User，我想本地已登录的旧配置（带 org 字段）被平滑处理或提示重新登录，以便升级 CLI 不产生僵尸状态

## Implementation Decisions

- **Gitea 仍是身份事实源**：用户 = 全局 Gitea 账号（无 `<组织>_` 前缀），Organization = Gitea Organization，团队 = Gitea Team，成员关系/团队/仓库协作者权限继续以 Gitea 为准；ESL DB 不建 users/memberships 表，只存技能、版本、发布物、申请与平台设置（ADR-0032）
- **废除项**：`<组织>_<用户名>` 账号拼装、`<org>_admin` 专用账号、system-admins 团队、single/multi 部署模式、默认组织 bootstrap、组织共享级别（被常设团队授权取代）、Operation/Provisioning 全套机制、legacy `POST /api/skills` 创建路径
- **登录契约**：登录只提交 `username + password`（服务端经 Gitea 校验后查成员关系派生角色），登录响应携带角色与所属组织列表；CLI 本地配置移除 `org` 与 `role` 字段
- **注册**：服务端经 Git Backend 管理员 API 创建 Gitea 账号（用户自设密码，密码策略沿用现行三端一致的 Gitea 权威规则）；`registration_mode: open | approval`，approval 下注册完成后账号待审批激活
- **扁平命名池**：注册与建组织共用同一查重（已存在用户 / 已存在组织 / 保留名 → 拒绝），Gitea 原生唯一性兜底；用户名与组织名一律不可改名
- **组织创建**：`auto` 模式同步直调 Gitea 建 org（创建者入 Owners）；`manual` 模式申请表记录 + 超管批准后同步创建；`manual` 下申请提交时查重范围包含待审申请；申请拒绝即释放名字
- **常设团队**：每个组织创建时建四个团队——组织只读团队（Read）、组织读写团队（Write）、组织技能管理团队（Manage）、组织管理员团队（= Gitea Owners）；成员进出组织时自动增删前三个团队 membership；常设团队不可删除/改名，可预置显示名；自定义团队由任意 Organization Admin 管理
- **release.json v3**（来自共识的 schema 决定）：
  ```
  { schemaVersion: 3, name: "@scope/skill-name" | "skill-name", version: SemVer,
    license, keywords, compatibility, dependencies }   // name 必填；v2 拒绝并提示升级
  ```
  无 scope 的 `name` 解析为上传者的个人命名空间
- **身份固定于首次 Source Upload**：服务器按 release.json `name` 校验上传者权限（个人 / 组织成员）后在对应所有者名下创建 Gitea 仓库（`{scope}/{shortName}`，个人技能为个人仓库），登记 Skill ID；`publish` 断言 `name` 与既定身份一致，不一致拒绝——归属变更不得借发布顺车
- **可见性**：技能记录新增/沿用逐技能 `public | private`（默认 private）；public 对所有已登录用户可搜可装可作依赖；private 沿用现有权限矩阵（owner/maintainers + Gitea 团队/协作者，含新的常设团队）；权限矩阵的 `share_all_read/write/manage` 动作重新锚定为对三个常设团队的授权
- **跨命名空间搜索/清单**：search 与 inventory 不再按调用者组织过滤，改为按可见性（public ∪ 被授权 private）过滤；web 个人中心跨命名空间聚合，relation 标注 managed/shared
- **DB**：直接重写 SQL DDL（删 operations/operation_secrets 相关表与部署模式设置，organization 申请表保留并简化），无迁移框架需求——现有数据经 Bootstrap Reset 推倒重建

## Testing Decisions

- **好测试只测外部行为**：API 的状态码与响应体、CLI 的输出与退出码、安装目录里的产物与锁文件；不断言内部调用序列、不窥探中间状态
- **Seam 1（主）：Registry API 级**——`buildApp()` + 临时 SQLite + 升级版假 Gitea 服务（有状态 fake，支持全局账号、组织、Owners/常设团队、协作者）。承载：登录、注册、建组织、查重、publish 断言、可见性门控、权限矩阵、常设团队自动进出。先例：`rbac-permissions.test.ts` 的有状态假 Gitea 模式
- **Seam 2：core 纯函数**——release.json v3 校验（name 必填/格式/v2 拒绝）、身份解析、保留名清单。先例：`release-manifest.test.ts`、`org-name.test.ts`
- **Seam 3：CLI 命令**——`executeXxx` + git/HTTP 双打（`createGitMock` 模式）。只测 CLI 侧新行为：init 默认 name、无组织登录、publish 断言失败的报错、upload 组织权限错误。先例：`publish.test.ts`、`login.test.ts`
- **Seam 4：E2E 金路径**——真实 Gitea 栈上跑一条链：注册 → 建组织 → 拉人 → `@org` 发布 → 他组织用户装 public 技能成功 / 装 private 技能被拒。沿用现有 e2e 套件与 Gitea Contents API 造数方式
- **已知陷阱**：cli/server 测试读 core 的 dist——改 core 后必须先 build 再跑测试，否则假绿
- 不新增任何 seam；web 测试跟随现有 `packages/web/tests` 模式作为跟随项

## Out of Scope

- 跨命名空间移动技能（v1 明确禁止，后续可基于 rename+redirect 机制补）
- 用户名/组织名改名
- 既有数据迁移（一律 Bootstrap Reset 重建）
- 未登录匿名访问（public 仍需登录才可安装/搜索）
- 团队级细粒度发布权（npm package-level access 旋钮）；只有 Read/Write/Manage 三档
- 组织数量/成员数量配额、计费、套餐
- Git Backend 之外的后端（Gitea 锁定不变）
- Web 控制台的视觉重构（只做视角重组：个人中心聚合、组织页、超管页）

## Further Notes

- CONTEXT.md 已按目标模型重写，与未改造完成的代码之间存在**过渡期不一致**——实施时以本 spec 与 ADR-0032 为准，代码逐步对齐
- ADR-0032 取代 ADR-0016、ADR-0022、ADR-0024、ADR-0026，部分取代 ADR-0020；实施中遇到这些旧 ADR 的描述与现状冲突，以 ADR-0032 为准
- 环境注意事项：改 server 需重建 api 镜像、改 web 需 deploy:web、`npm run reset:dev` 是本次开发期的常驻动作、E2E 发布造数经 Gitea Contents API
- 建议实施顺序：core（v3 schema）→ server（身份/组织/可见性）→ CLI（login/init/upload/publish）→ web（视角重组）→ E2E 收口
