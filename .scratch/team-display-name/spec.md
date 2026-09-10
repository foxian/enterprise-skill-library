# 团队显示名与团队编辑（Team Display Name & Team Edit）

## Problem Statement

组织团队在 ESL 管理界面只能显示 ASCII 标识名（如 `backend`），团队名无法用中文表达，团队管理列表里"团队名"一列展示的就是这个机器名。同时团队权限档（只读/读写/管理）在建团队后无法调整——想改变团队的能力上限只能删除重建，且现有"改名"入口只支持改标识名。

用户希望：团队能用中文展示、团队管理列表同时看到展示名与机器名、团队可整体编辑（显示名、标识名、权限级别）。

## Solution

团队拆为两个概念：**团队标识名**（Team Identifier，机器名，小写字母/数字/连字符，唯一键，即 Gitea 团队名）与**团队显示名**（Team Display Name，ESL 侧可选中文展示名，非唯一，未设置回退标识名）。团队管理列表两列并排展示。自定义团队可通过"编辑"操作同时修改标识名、显示名、权限级别；权限级别变更时提示影响面并二次确认。

显示名只存 ESL 数据库，不写入 Gitea（ADR-0029）。Gitea 侧零改动。

## User Stories

1. 作为组织管理员，我想在创建自定义团队时输入一个可选的中文显示名，以便团队在界面中用中文被识别，而不是只有 `backend` 这种机器名。
2. 作为组织管理员，我想在团队管理列表中同时看到团队的显示名与标识名两列，以便一眼区分"给人看的名字"与"机器用的名字"。
3. 作为组织管理员，我想在团队管理列表中看到未设置显示名的团队以「—」呈现，以便明确知道哪些团队还没有显示名。
4. 作为组织管理员，我想通过"编辑"操作而不是"改名"来修改一个自定义团队，以便在一个对话框里同时调整标识名、显示名与权限级别。
5. 作为组织管理员，我想在编辑对话框中修改团队的权限级别（只读/读写/管理），以便调整团队的能力上限而无需删除重建。
6. 作为组织管理员，当我在编辑对话框中改变团队的权限级别时，我想看到"该团队已授权 N 个技能，变更将实时改变这些技能的访问级别"的提示，以便了解变更的跨技能影响面。
7. 作为组织管理员，当权限级别确实要改变时，我想在保存前被二次确认，以便避免误操作导致静默越权或降权（调高和调低都要确认——调高是静默越权方向）。
8. 作为组织管理员，我想在编辑对话框中修改团队的标识名，以便修正拼写或调整命名而不重建团队；标识名变更不影响已挂载技能（按团队 ID 引用）。
9. 作为组织管理员，我想在编辑对话框中修改团队的显示名，以便随时更换团队的中文称呼；清空显示名后界面回退显示标识名。
10. 作为组织管理员，我想在编辑对话框中看到标识名的格式约束提示（小写字母、数字、连字符），以便知道哪些名字不合法。
11. 作为成员，我想在技能权限面板（SkillPermissionsPanel）的授权下拉与已授权标签中看到团队的显示名（未设置则回退标识名），以便用熟悉的语言识别团队。
12. 作为成员，我想看到系统管理团队以"系统管理团队"而非 `system-admins` 展示，无论该组织是新建还是存量。
13. 作为组织管理员，我想让系统管理团队（唯一可见的默认团队）的显示名作为数据存在、由平台预置并随组织初始化写入，以便前端不再硬编码默认团队标签。
14. 作为组织管理员，我想在删除自定义团队时其显示名记录一并清理，以便不留孤儿数据。
15. 作为组织管理员，我想看到"编辑"操作仅对自定义团队可用、默认团队与 Owners 团队不可编辑，以便保持 ADR-0026"默认团队不可改名/不可删"的治理边界。

## Implementation Decisions

- **存储**：新表 `org_team_profiles(org_name, gitea_team_id, display_name)`，主键 `(org_name, gitea_team_id)`；键按 Gitea team ID——标识名改名不丢显示名（与 ADR-0026"改名不断授权"同一语义）。`CREATE TABLE IF NOT EXISTS` 追加到 `databaseSchema`，老部署下次启动自动建表，无需迁移框架。
- **显示名语义**：ESL 侧字段，可选、可重复、允许中文；创建时缺省即无；PATCH 时字段存在即覆盖（空串/`null` 清空），不存在则保持。未设置显示名在列表中显示「—」，在权限面板回退显示标识名。不参与唯一性、默认团队识别或授权判定（CONTEXT.md 已定义）。
- **存储位置**：显示名只存 ESL DB（ADR-0029 方案 A），不写 Gitea Team `description`；Gitea 团队保持纯 ASCII。
- **API 契约**：
  - `GET /api/orgs/teams`：响应每项新增 `display_name`；读取时对无 profile 的 `system-admins` 惰性播种种子行（回填存量组织）。
  - `POST /api/orgs/teams`：body 新增可选 `display_name`（独立于标识名校验：可选、去空格、非空、限长）。
  - `PATCH /api/orgs/teams/:teamId`：body 扩展为 `name`/`permission`/`display_name` 三字段全可选；`name` 维持 `[a-z0-9-]{1,64}`，`permission` 限 read/write/manage（manage 映射 Gitea admin）；仅 `display_name` 变化时不调 Gitea。
  - `DELETE /api/orgs/teams/:teamId`：删除成功后清理该团队 profile 行。
- **权限变更落 Gitea**：`GiteaService.renameTeam` 泛化为 `updateTeam(teamId, { name?, permission? })`；`permission` 变化时 PATCH 连带 `units_map`（复用 createTeam 的 units 构建，保证单元级授权与顶级权限一致——Gitea EditTeam 部分更新，只发 permission 会留下单元级旧值）。只发 `name` 保持现状。
- **权限与技能访问联动**：技能权限矩阵由 Gitea 实时派生（`getPermissionMatrix`），成员的技能访问级别 = 团队当前权限档。故编辑权限即改变该团队挂载的所有技能上全体成员的访问级别——前端在权限档位变化时显示"该团队已授权 N 个技能，变更将实时改变这些技能的访问级别"，并弹二次确认（调高/调低都弹）。
- **默认团队显示名**：只种 `system-admins`（唯一有 UI 消费点的默认团队）→「系统管理团队」；org-init 播种 + 路由读时惰性播种回填存量；前端 `DEFAULT_TEAM_LABELS` 硬编码删除。三个全员团队不种（无消费点，种了是死数据）。
- **前端消费点**：
  - `TeamsView.vue`：团队列改两列（显示名 / 标识名，未设置显示名显示「—」）；操作列改「编辑 / 删除」；编辑对话框含 权限级别（radio）+ 显示名 + 标识名，权限变化时提示影响面并二次确认；data-test 仍按标识名定位。
  - `SkillPermissionsPanel.vue`：授权下拉标签与已授权标签用显示名（未设置回退标识名）；`<el-option>` value 与 `remove_team` 请求体仍用标识名。
  - `TeamMemberPanel.vue` 不动（data-test 与 system-admins 识别均按标识名）。
- **标识名改名不破坏技能授权**：矩阵按 Gitea repo mount（ID）派生、名字现读，改名自动跟随，无需迁移授权数据。
- **Gitea 侧零改动**。

## Testing Decisions

- **只测外部行为，不测实现细节**：断言 API 响应/请求契约、Gitea 调用形状（收到正确参数）、DB 落盘结果，不测 SQL 语句本身。
- **主缝**：org-console HTTP 路由层（`packages/server/tests/org-console.test.ts` 现有模式：真实 SQLite + mock `giteaService` 注入 `buildApp`）。覆盖：
  - GET 返回 `display_name`；无 profile 的 `system-admins` 惰性播种后返回「系统管理团队」。
  - POST 带 `display_name` 时落库并在响应返回。
  - PATCH 仅改显示名时**不**调用 Gitea；PATCH 改权限时 `giteaService.updateTeam` 收到 `{ name, permission, units_map }`；PATCH 清空显示名（空串）后 GET 显示「—」。
  - PATCH 改权限对系统团队返回 400。
  - DELETE 后 profile 清理。
- **副缝**：web 组件测试（`packages/web/tests/org-console.test.ts`、`skill-permissions.test.ts` 现有模式）——TeamsView 两列渲染、编辑对话框字段与权限二次确认、SkillPermissionsPanel 显示名回退。
- **Gitea 服务单测**（`packages/server/tests/gitea-service.test.ts`）——`updateTeam` 改权限时请求体含 `units_map`。
- 不新增第三处缝。

## Out of Scope

- 团队标识名支持中文（标识名保持 `[a-z0-9-]{1,64}`；中文走显示名）。
- 技能授权与团队权限解耦（矩阵档位不再实时派生）——B 方案，更大的架构改动，另行评估。
- 在 Gitea Web UI 后台显示中文（Gitea 团队保持 ASCII，中文只在 ESL 控制台）。
- 三个全员默认团队（all-readers/all-writers/all-managers）的显示名播种。
- 显示名唯一性约束（可重复是设计决定）。

## Further Notes

- 相关 ADR：0025（Manage 档位与角色可见性）、0026（默认团队阶梯与系统管理团队）、0029（团队显示名存于 ESL 数据库，本特性实施它）。
- CONTEXT.md 已新增「团队标识名 / 团队显示名」词条。
- 权限级别编辑是全库联动操作：这是首次给"团队权限档"接上可编辑入口，影响面提示与二次确认是硬要求，不是可选项。
