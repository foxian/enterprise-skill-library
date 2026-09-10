# ESL 组织管理控制台测试计划 — 四默认团队 / 系统管理团队 / 组织共享级别 (Issue #37 / ADR-0026)

## Application Overview

# 测试计划：四默认团队 / 系统管理团队 / 组织共享级别

## Scope

覆盖 org admin 控制台在 ADR-0026（及修订 ADR-0025）下的行为：

1. 团队管理页（TeamsView）：三个全员团队（只读/读写/技能管理）与 Owners 不显示，仅系统管理团队保留默认标签；默认团队不可删除、不可改名（按钮禁用）；自定义团队可创建（read/write/manage 三档）、可改名、可删除。
2. 系统管理团队：成员面板中 admin 账号不可移除；可添加/移除普通成员。
3. 成员生命周期：新建成员自动加入三个全员团队（经 Git Backend API 断言，团队管理页不展示其成员面板）；禁用后从全部团队移除；重新启用只回三个全员团队、不回系统管理团队。
4. 技能权限面板：组织共享级别单选控件（不共享/全员只读/全员读写/全员管理），设置更高级别取代低级别；团队授权下拉只列自定义团队；成员授权下拉不含 admin 与系统管理团队成员。
5. 系统管理团队成员登录后进入组织管理控制台（role org-admin）；普通成员登录仍是成员视图。

## 被测环境

- 管理后台：`http://localhost:3000/admin/`；默认组织 `esl` 已开通并预置四个默认团队。
- 组织管理员登录：用户名 `admin`、组织 `esl`、密码取仓库根 `.env` 的 `ESL_ORG_ADMIN_PASSWORD`。
- 测试成员：经 API/UI 创建，初始密码统一 `e2e-member-password`（`MEMBER_PASSWORD`，满足 >=12 位策略）。
- 角色由服务端判定：admin 账号 ∪ system-admins 成员 → `org-admin`；其余成员 → `member`（`/api/console/login`，auth.ts）。

## 测试约定（house style，务必遵守）

- Page Object 只返回 locator（`e2e/pages/*.page.ts`）；选择器统一 `data-test` kebab-case（`testIdAttribute: 'data-test'`）。
- 成员/团队/权限变更均为异步 Operation，断言用 `expect.poll` 等待终态，禁止固定 sleep。
- 每个用例假定干净起点（fresh state），自造数据（成员、团队、技能）并在收尾 best-effort 清理；技能用 super API `deleteSkill` 清理。
- 表格行定位用 `getByRole('row').filter({ hasText: ... })`；行内按钮的 data-test 用完整 Gitea 用户名（`<org>_<username>`）。
- 团队成员面板挂在 el-table expand 行内，data-test 为 `team-members-<team.name>`（team.name 为原始 Gitea 团队名）。
- 大超时只在已知慢的断言点显式指定（如 30s/60s），不设全局 actionTimeout。

## Coverage Matrix（场景 → 优先级 → 预期结果）

| # | 场景 | 优先级 | 预期结果 |
|---|------|--------|----------|
| A-01 | 三个全员团队与 Owners 不显示，仅系统管理团队保留默认标签 | P0 | 系统管理团队行带中文标签/管理档位/「默认团队」标签（计数 1）；只读/读写/技能管理/Owners 均无行 |
| A-02 | 默认团队不可删除、不可改名（按钮禁用 + 后端拒绝） | P0 | 系统管理团队改名/删除按钮 disabled；API 直调 PATCH/DELETE 默认团队返回 400 |
| A-03 | 自定义团队可创建（read/write/manage 三档） | P0 | 三个档位各可创建成功，列表出现「自定义」标签与对应权限文本，团队计数 +3 |
| A-04 | 自定义团队可改名且权限保留 | P0 | 新名生效、权限档位不变、类型仍为自定义，旧名消失 |
| A-05 | 自定义团队可删除 | P0 | 确认后团队从列表移除 |
| A-06 | 自定义团队非法名被拒 | P1 | 大写/下划线/超长名在 UI 报错，团队不创建；后端 400 |
| B-01 | system-admins 中 admin 账号不可移除 | P0 | admin 行显示「管理员」徽标（owner-admin-badge），无移除按钮 |
| B-02 | 可添加/移除普通成员进出 system-admins | P0 | 普通成员可加入并出现在面板；可被移除 |
| C-01 | 新建成员自动加入三个全员团队 | P0 | 新成员经 Gitea API 出现在 all-readers/all-writers/all-managers，不出现在 system-admins |
| C-02 | 禁用成员后从全部团队移除 | P0 | 成员离开在册列表进入「已禁用」tab，且经 Gitea API 从全部团队移出 |
| C-03 | 重新启用只回三个全员团队、不回系统管理团队 | P0 | 启用后经 Gitea API 回到三个全员团队，system-admins 无该成员 |
| D-01 | 组织共享级别单选；更高级别取代低级别 | P0 | 单选控件显示当前档；设置高级别自动卸载低级别全员团队；回到「不共享」恢复私有 |
| D-02 | 团队授权下拉仅列自定义团队 | P0 | 下拉含自定义团队，不含四个默认团队与 Owners |
| D-03 | 成员授权下拉排除 admin 与系统管理团队成员 | P0 | 下拉不含 admin、不含 system-admins 成员，含普通成员 |
| E-01 | 系统管理团队成员登录进入组织管理控制台 | P0 | 登录后 URL /admin/org/members，菜单含成员管理/团队管理/技能权限（role=org-admin） |
| E-02 | 普通成员登录仍为成员视图 | P0 | 登录后 URL /admin/member/skills，仅「我管理的技能」菜单；直接访问 /admin/org/members 被路由守卫弹回登录页 |

## Test Scenarios

### 1. A. 团队管理页 (TeamsView)

**Seed:** `e2e/tests/seed.spec.ts`

#### 1.1. [P0] A-01 三个全员团队与 Owners 不显示，仅系统管理团队保留默认标签

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 以组织管理员登录（用户名 admin、组织 esl、密码取 .env 的 ESL_ORG_ADMIN_PASSWORD），导航到 /admin/org/teams
    - expect: URL 为 /admin/org/teams，teams-table 可见
  2. 断言系统管理团队行存在，带中文标签、管理档位与「默认团队」标签
    - expect: 行文本含「系统管理团队」「管理」；行内 data-test=default-team-tag 可见；页面 default-team-tag 计数为 1
  3. 断言三个全员团队不展示（服务端 /api/orgs/teams 已过滤；组织共享级别承载其授权）
    - expect: 只读团队 / 读写团队 / 技能管理团队 均无行
  4. 断言列表不含 Owners 团队
    - expect: 无任何行文本包含 Owners
  5. 数据测试选择器已核实存在
    - expect: teams-table、default-team-tag

#### 1.2. [P0] A-02 默认团队不可删除、不可改名（按钮禁用 + 后端拒绝）

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 导航到 /admin/org/teams，等待 teams-table 可见
    - expect: 页面就绪
  2. 团队管理页可见的默认团队为系统管理团队:断言 rename-team-system-admins 与 delete-team-system-admins 按钮存在且 disabled
    - expect: 两个按钮均为 disabled
  3. （后端防护）用 adminApi 对系统管理团队 PATCH /api/orgs/teams/:id 传新名
    - expect: 返回 400，错误信息含 System teams cannot be renamed
  4. （后端防护）用 adminApi 对系统管理团队 DELETE /api/orgs/teams/:id
    - expect: 返回 400，错误信息含 System teams cannot be deleted
  5. 数据测试选择器已核实存在
    - expect: rename-team-system-admins、delete-team-system-admins

#### 1.3. [P0] A-03 自定义团队可创建（read/write/manage 三档）

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 导航到 /admin/org/teams，记录当前团队计数
    - expect: 页面就绪
  2. 点击 open-create-team，在 new-team-name 输入 e2e-team-read-<suffix>，在 new-team-permission 选择「只读」，点击 create-team-submit
    - expect: 对话框关闭，团队列表刷新后出现 e2e-team-read-<suffix> 行，类型标签为「自定义」，权限列为「只读」
  3. 重复创建 e2e-team-write-<suffix>（读写）与 e2e-team-manage-<suffix>（管理）
    - expect: 两行各自出现，权限列为「读写」「管理」
  4. 断言工具栏团队计数为初始值 +3
    - expect: 团队计数正确，三个自定义团队都在列表中
  5. （清理）对自造自定义团队逐个删除，恢复 fresh state
    - expect: 列表回到初始状态
  6. 数据测试选择器已核实存在
    - expect: open-create-team、new-team-name、new-team-permission、create-team-submit、teams-table

#### 1.4. [P0] A-04 自定义团队可改名且权限保留

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 创建自定义团队 e2e-team-rename-<suffix>（权限=读写）
    - expect: 团队出现在列表
  2. 点击 rename-team-e2e-team-rename-<suffix>，在 rename-team-name 输入新名 e2e-team-renamed-<suffix>，点击 rename-team-confirm
    - expect: 对话框关闭，成功提示「团队已重命名」
  3. 断言列表出现 e2e-team-renamed-<suffix> 行且旧名消失
    - expect: 新名可见、旧名不存在
  4. 断言该行权限列仍为「读写」、类型标签仍为「自定义」（改名按团队 ID 引用，不断授权）
    - expect: 权限档位与类型保持不变
  5. （清理）删除该自定义团队
    - expect: 列表回到初始状态
  6. 数据测试选择器已核实存在
    - expect: rename-team-<name>、rename-team-name、rename-team-confirm

#### 1.5. [P0] A-05 自定义团队可删除

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 创建自定义团队 e2e-team-del-<suffix>
    - expect: 团队出现在列表
  2. 点击 delete-team-e2e-team-del-<suffix>
    - expect: 出现删除确认对话框，文案含团队名 e2e-team-del-<suffix>
  3. 点击 delete-team-confirm
    - expect: 对话框关闭，成功提示「团队已删除」，列表不再包含该团队
  4. 数据测试选择器已核实存在
    - expect: delete-team-<name>、delete-team-confirm

#### 1.6. [P1] A-06 自定义团队非法名被拒

**File:** `e2e/tests/teams-view.spec.ts`

**Steps:**
  1. 导航到 /admin/org/teams，点击 open-create-team，在 new-team-name 输入含大写/下划线的非法名（如 Bad_Team），选择只读，点击 create-team-submit
    - expect: 页面显示错误（page-error 或后端 400 文案），团队未创建
  2. 对超长名（如 65 个 a）重复创建
    - expect: 同样被拒，团队不创建
  3. （后端防护）用 adminApi POST /api/orgs/teams 传非法名
    - expect: 返回 400，错误信息含 Team name must use lowercase letters, digits, and hyphens
  4. 数据测试选择器已核实存在
    - expect: open-create-team、new-team-name、create-team-submit、page-error

### 2. B. 系统管理团队 (System Management Team)

**Seed:** `e2e/tests/seed.spec.ts`

#### 2.1. [P0] B-01 system-admins 中 admin 账号不可移除

**File:** `e2e/tests/system-admin-team.spec.ts`

**Steps:**
  1. 导航到 /admin/org/teams，点击 system-admins 行的展开箭头
    - expect: 团队成员面板出现，data-test=team-members-system-admins 表格可见
  2. 在面板中定位 admin 行（短名 admin）
    - expect: admin 行显示 data-test=owner-admin-badge 的「管理员」警告标签（isProtectedOwner 命中，不渲染移除按钮）
  3. 断言 admin 行不存在 team-remove-<org>_admin 按钮
    - expect: getByTestId('team-remove-esl_admin') 数量为 0
  4. （后端防护）用 adminApi DELETE /api/orgs/teams/:systemAdminsId/members/admin
    - expect: 返回 400，错误信息含 Organization administrator cannot be removed from the system admins team
  5. 数据测试选择器已核实存在
    - expect: team-members-system-admins、owner-admin-badge、team-remove-<fullname>

#### 2.2. [P0] B-02 可添加/移除普通成员进出 system-admins

**File:** `e2e/tests/system-admin-team.spec.ts`

**Steps:**
  1. 经成员管理页（或 adminApi）创建普通成员 e2e-sa-<suffix>（完整用户名 <org>_e2e-sa-<suffix>）
    - expect: 成员出现在在册成员列表
  2. 导航到 /admin/org/teams，展开 system-admins 行，在 team-add-username 输入短名 e2e-sa-<suffix>，点击 team-add-submit
    - expect: 成功提示，成员出现在 team-members-system-admins 面板（异步，poll 至 30s）
  3. 点击 team-remove-<org>_e2e-sa-<suffix>
    - expect: 成功提示「已移除」，成员行从 system-admins 面板消失
  4. （清理）如需保持 fresh，可禁用并删除该成员
    - expect: 不残留测试数据
  5. 数据测试选择器已核实存在
    - expect: team-add-username、team-add-submit、team-members-system-admins、team-remove-<fullname>

### 3. C. 成员生命周期 (Member Lifecycle)

**Seed:** `e2e/tests/seed.spec.ts`

#### 3.1. [P0] C-01 新建成员自动加入三个全员团队

**File:** `e2e/tests/member-lifecycle.spec.ts`

**Steps:**
  1. 在成员管理页添加成员 e2e-life-<suffix>（密码 MEMBER_PASSWORD），等待出现在在册列表
    - expect: 成员创建完成（异步 Operation，poll 至 30s）
  2. 经 Gitea admin API（data/secrets/gitea-admin-token，宿主 3001）读取三个全员团队与 system-admins 的团队 ID
    - expect: all-readers/all-writers/all-managers/system-admins 团队均存在
  3. 逐一断言完整用户名出现在三个全员团队（Gitea /api/v1/teams/:id/members，poll 至 30s）
    - expect: 新成员出现在 all-readers、all-writers、all-managers
  4. 断言成员不出现在 system-admins
    - expect: system-admins 成员列表不含该成员（新成员默认不加入系统管理团队）
  5. 数据测试选择器已核实存在
    - expect: open-add-member、add-member-username、add-member-password、add-member-submit

#### 3.2. [P0] C-02 禁用成员后从全部团队移除

**File:** `e2e/tests/member-lifecycle.spec.ts`

**Steps:**
  1. 创建成员 e2e-life-<suffix> 并确认其已加入三个全员团队（同 C-01，经 Gitea API）
    - expect: 成员在三个全员团队中
  2. 回到成员管理页，点击 disable-<org>_e2e-life-<suffix>，在对话框点击 disable-member-confirm
    - expect: 成功提示「已禁用」，成员从在册成员列表消失
  3. 断言出现「已禁用」tab（disabled-members-tab），切换后成员在 disabled-members-table 中
    - expect: 禁用成员被列入已禁用列表
  4. 经 Gitea API 逐一断言三个全员团队与 system-admins 均不含该成员（poll 至 30s）
    - expect: 禁用清出全部团队（后端 removeTeamMember 全部执行）
  5. 数据测试选择器已核实存在
    - expect: disable-<fullname>、disable-member-confirm、disabled-members-tab、disabled-members-table

#### 3.3. [P0] C-03 重新启用只回三个全员团队、不回系统管理团队

**File:** `e2e/tests/member-lifecycle.spec.ts`

**Steps:**
  1. 创建成员 e2e-life2-<suffix>，并用 adminApi 把它加入 system-admins（/api/orgs/teams/:id/members，团队 ID 经 Gitea 获取）
    - expect: 成员同时存在于三个全员团队与 system-admins
  2. 在成员管理页禁用该成员（disable-<org>_e2e-life2-<suffix> + disable-member-confirm）
    - expect: 成员进入已禁用列表，并从全部团队移出
  3. 在已禁用 tab 点击 enable-<org>_e2e-life2-<suffix>
    - expect: 成功提示「已启用」，成员回到在册成员列表（异步 poll）
  4. 经 Gitea API 断言成员回到三个全员团队
    - expect: all-readers/all-writers/all-managers 均含该成员（member.enable 只重加入 ALL_MEMBER_TEAM_NAMES）
  5. 经 Gitea API 断言 system-admins 不含该成员
    - expect: 重新启用不回系统管理团队
  6. 数据测试选择器已核实存在
    - expect: enable-<fullname>、disabled-members-tab

### 4. D. 技能权限面板 — 组织共享级别 (Skill Permissions / Sharing Level)

**Seed:** `e2e/tests/seed.spec.ts`

#### 4.1. [P0] D-01 组织共享级别单选；设置更高级别取代低级别

**File:** `e2e/tests/share-levels.spec.ts`

**Steps:**
  1. 造数：adminApi createOrgMember(e2e-owner-<suffix>)；以该成员 API 登录并 uploadSkill(e2e-share-<suffix>) 创建私有未发布技能
    - expect: 技能创建成功（201）
  2. 以组织管理员登录，导航到 /admin/org/skills，点击 configure-e2e-share-<suffix>
    - expect: 进入权限面板，skill-permissions-panel 可见，URL 为 /admin/org/skills/<scope>/<skillName>/permissions
  3. 断言 share-state 标签初始为「仅创建者」、share-level 单选组当前为「不共享（私有）」
    - expect: 私有技能默认不共享，单选项有四个：不共享（私有）/全员只读/全员读写/全员管理
  4. 点击「全员只读」（share-level 内 radio）
    - expect: share-state 变为「全员只读」（success 标签），单选落到全员只读
  5. 点击「全员读写」
    - expect: share-state 变为「全员读写」，页面只显示一个共享标签（更高级别自动卸载 all-readers 挂载，互斥语义）
  6. 点击「全员管理」
    - expect: share-state 变为「全员管理」，低级别标签不残留
  7. 点击「不共享（私有）」
    - expect: share-state 回到「仅创建者」，所有全员团队挂载被卸载（reset_to_private）
  8. （清理）用 super API deleteSkill 删除该技能
    - expect: best-effort 清理成功
  9. 数据测试选择器已核实存在
    - expect: skill-permissions-panel、share-state、share-level、configure-<skillName>

#### 4.2. [P0] D-02 团队授权下拉仅列自定义团队

**File:** `e2e/tests/share-levels.spec.ts`

**Steps:**
  1. 先创建自定义团队 e2e-custom-<suffix>（确保 teamOptions 非空，面板渲染 team-select 而非 team-input）
    - expect: 自定义团队创建成功
  2. 按 D-01 造数并进入某技能权限面板
    - expect: skill-permissions-panel 可见，存在 team-select 下拉
  3. 点击 team-select 展开选项
    - expect: 选项包含 e2e-custom-<suffix>（及其权限文本）
  4. 断言下拉不含四个默认团队（只读团队/读写团队/技能管理团队/系统管理团队）与 Owners
    - expect: 默认团队与 Owners 不出现在选项（org SkillPermissionsView 已 filter DEFAULT_TEAM_NAMES）
  5. 数据测试选择器已核实存在
    - expect: team-select、team-input

#### 4.3. [P0] D-03 成员授权下拉排除 admin 与系统管理团队成员

**File:** `e2e/tests/share-levels.spec.ts`

**Steps:**
  1. 创建普通成员 e2e-member-<suffix>，再创建 e2e-sa2-<suffix> 并把它加入 system-admins（B-02 流程）
    - expect: 两个成员就绪，e2e-sa2-<suffix> 是系统管理团队成员
  2. 按 D-01 造数并进入某技能权限面板
    - expect: skill-permissions-panel 可见，存在 member-select 下拉
  3. 点击 member-select 展开选项
    - expect: 选项包含普通成员 e2e-member-<suffix>
  4. 断言下拉不含 admin、不含 e2e-sa2-<suffix>（系统管理团队成员）
    - expect: memberOptions 已排除 system-admins 成员与 <scope>_admin（org SkillPermissionsView）
  5. 数据测试选择器已核实存在
    - expect: member-select、member-input

### 5. E. 角色路由 (Role-based Routing)

**Seed:** `e2e/tests/seed.spec.ts`

#### 5.1. [P0] E-01 系统管理团队成员登录进入组织管理控制台

**File:** `e2e/tests/role-routing.spec.ts`

**Steps:**
  1. 创建成员 e2e-role-admin-<suffix> 并加入 system-admins（B-02 流程）
    - expect: 成员就绪且为系统管理团队成员
  2. 登出当前会话，在登录页以用户名 e2e-role-admin-<suffix>、组织 esl、密码 MEMBER_PASSWORD 登录
    - expect: 登录成功
  3. 断言 URL 落到组织管理控制台首页
    - expect: URL 匹配 /admin/org/members（服务端 isOrganizationAdministrator 判定 role=org-admin，auth.homePath）
  4. 断言菜单含成员管理、团队管理、技能权限（OrgLayout menuItems）
    - expect: org admin 控制台导航完整呈现
  5. 数据测试选择器已核实存在
    - expect: username、org、password、login-submit

#### 5.2. [P0] E-02 普通成员登录仍为成员视图

**File:** `e2e/tests/role-routing.spec.ts`

**Steps:**
  1. 创建普通成员 e2e-role-member-<suffix>（不加入 system-admins）
    - expect: 成员就绪
  2. 以该成员在登录页登录（用户名、组织 esl、密码 MEMBER_PASSWORD）
    - expect: 登录成功
  3. 断言 URL 落到成员视图首页
    - expect: URL 匹配 /admin/member/skills（role=member，homePath）
  4. 断言菜单仅「我管理的技能」（MemberLayout menuItems）
    - expect: 无 org console 导航项
  5. 直接导航到 /admin/org/members
    - expect: 被路由守卫弹回 /admin/login（to.meta.role !== auth.role 即退回登录页）
  6. 数据测试选择器已核实存在
    - expect: username、org、password、login-submit
