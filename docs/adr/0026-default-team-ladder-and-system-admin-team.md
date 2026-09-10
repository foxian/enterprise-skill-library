# 四默认团队与系统管理团队（ADR-0025 修订）

Status: accepted

修订 ADR-0025 的团队模型：组织默认团队从两个（`all-readers` / `all-writers`）扩展为
四档阶梯，新增全员 Manage 团队（推翻 ADR-0025"不设全员 Manage 团队"的决定），并以
独立的系统管理团队承载组织管理权委托，而非映射 Gitea Owners 团队。

## 背景与动因

1. 全员 Read/Write 两档不足以表达"全员协作管理技能"的组织形态；ADR-0025 以
   "没有合理治理场景"否决全员 Manage，但在小型可信组织的实际部署中该场景成立。
2. 组织管理权此前绑定在单一 `<org>_admin` 账号上，既无法委托给多个真人成员，
   也无法收回。
3. Gitea 默认的 Owners 团队出现在团队管理界面，与 ESL 的团队语义（三档授权
   目标）不匹配，且其"owner"权限档位游离于 ESL 三档词汇之外。

## 核心决策

### 1. 四档默认团队

| 团队 | Gitea 团队名 | 档位 | 成员 | 仓库授权 |
|---|---|---|---|---|
| 只读团队 | `all-readers` | Read | 全员自动同步 | 指定仓库 |
| 读写团队 | `all-writers` | Write | 全员自动同步 | 指定仓库 |
| 技能管理团队 | `all-managers` | Manage | 全员自动同步 | 指定仓库 |
| 系统管理团队 | `system-admins` | 全库 Admin + 建库权 | admin 自动加入 + 手动 | 全部仓库（结构性） |

- 默认团队不可删除、不可改名；前三个全员团队的成员列表只读，跟随组织成员
  自动同步，不可手动增删。
- 成员禁用时移出全部团队（含系统管理团队）；重新启用时只回三个全员团队，
  不回系统管理团队。
- "无建库权"仅约束成员绕过 ESL 在 Git Backend 直接建库；Source Upload 的
  仓库创建由 ESL Server 以服务账号代执行，不受团队建库权影响。

### 2. 系统管理团队 = ESL 层委托，不映射 Gitea Owners

- 系统管理团队是独立 Gitea 团队（全部仓库 admin + 建库权），**不是** Gitea
  Owners 团队。
- Gitea Owners 团队从团队管理界面隐藏，永远仅含 `<org>_admin` 账号——组织
  admin 账号是唯一 Gitea Owner。
- **Organization Admin 从"单一账号"重定义为角色**：由 admin 账号与系统管理
  团队成员共同持有；系统管理团队成员登录管理后台即 org-admin 角色，拥有与
  admin 账号完全相同的控制台（成员管理、团队管理、技能权限）。
- 授权判定在 ESL 层实现（admin 账号 ∪ system-admins 成员）。这可行是因为
  所有 Gitea 变更本就由 ESL 以服务账号 token 代执行，不依赖成员自身的
  Gitea Owner 身份。
- 系统管理团队成员可互管该团队（互相加入/移出），唯 admin 账号不可移出。

### 3. 全员 Manage 与组织共享级别

- 推翻 ADR-0025 §1 中"不设全员 Manage 团队"：`all-managers` 全员团队成立，
  技能授予该团队即全员持有 Manage（发布 Release、配置权限、授予/撤销
  管理权）。
- 全员共享从独立按钮重组为互斥的**组织共享级别**（私有 / 全员只读 /
  全员读写 / 全员管理，单选、显示当前状态，取代原"快捷操作"区）；API
  动作 `share_all_read` / `share_all_write` / `share_all_manage` /
  `reset_to_private` 名称保持，互斥语义在服务端固化——设置高级别时自动
  卸载低级别全员团队。
- 技能权限面板的团队授权下拉仅列**自定义团队**：四个默认团队与 Owners
  全部过滤（全员团队由共享级别承载，系统管理团队与 Owners 的权限是
  结构性的全库授权，逐技能授予无意义）。
- 成员授权下拉排除组织 admin 账号与系统管理团队成员（两者均结构性持有
  全部技能的 Manage，逐技能授权无意义且会造成"可撤销"错觉）；存量
  无意义授权在迁移中清理。

### 4. 自定义团队

- 权限档位维持 Read/Write/Manage 三档；成员与指定仓库手动管理。
- 可创建、可删除、**可改名**：Gitea 仓库挂载按团队 ID 引用，改名不断授权。
- 团队的创建、改名、删除、成员与授权仓库管理，仅限组织 admin（admin 账号
  与系统管理团队成员）；普通成员不可。

## 影响与后果 (Consequences)

1. org-admin 判定从"用户名 = admin"扩展为"admin 账号 ∪ system-admins 成员"，
   波及三处独立推导点：`deriveOrganizationRole`（登录角色）、
   `requireOrgAdministrator`（org 控制台路由）、`getAccessLevel` 的
   `${scope}_admin` 判定（技能权限）。
2. `member.create` / `member.enable` 的自动入队从两个团队扩为三个；
   `member.disable` 清出全部团队。
3. 存量组织迁移：`all-readers` / `all-writers` 名称不变，补建 `all-managers`
   与 `system-admins`（admin 账号自动加入）；自定义团队与既有授权全部保留。
4. `GiteaService` 需补能力：`createTeam` 支持全部仓库授权与建库权标记、团队
   改名 API。
5. ADR-0025 中"不设全员 Manage 团队"与"`share_all_write` 之上不新增快捷
   操作"两条被本 ADR 取代；其余（三档模型、管理权语义、角色化技能可见性、
   publish 守门、upload 默认私有）不变。
6. CONTEXT.md 的 **Organization Team**、**Organization Admin** 词条已随本 ADR
   修订，并新增 **系统管理团队 (System Management Team)** 词条。
7. 展示层细化：三个全员团队（`all-readers` / `all-writers` / `all-managers`）与
   Owners 一样不展示于团队管理界面——其授权由组织共享级别承载、成员自动同步，
   无可管理对象；`GET /api/orgs/teams` 同步过滤（仅返回系统管理团队与自定义
   团队），技能权限面板所需的 `system-admins` 定位不受影响。成员生命周期用例
   对这三个团队的断言改经 Git Backend API（Gitea）验证，团队管理页不再展开其
   成员面板。
