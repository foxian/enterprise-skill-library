# 管理权档位与角色化技能可见性（ADR-0016 修订）

Status: accepted

修订 ADR-0016 的权限粒度模型：将技能权限档位从 Read/Write 两档扩展为
Read/Write/Manage 三档，把"管理权"从隐含事实（创建者即维护者）升级为可
授予、可撤销的一等权限，并按角色（超级管理员/组织管理员/成员）重定义技能
列表的可见范围。权限事实来源维持 Git Backend（Gitea）一处不变。

## 背景与动因

1. **管理权不可传递**：ADR-0016 模型下 `maintainers` 固定为上传者本人，
   技能无法移交给他人或团队协作管理；唯一维护者离职后只能依赖治理兜底。
2. **团队只有两档**：Organization Team 仅支持 Read/Write 访问级别，无法
   表达"团队代管技能"。
3. **publish 守门不一致**：发布路由只认 `maintainers` 列表，owner 与组织
   管理员反而不在放行范围内，与管理权语义脱节。
4. **可见性视图缺失**：成员只能看到自己创建且已发布的技能——通过授权
   获得可读/可写的技能、以及未发布（`active-unreleased`）的技能在任何
   列表页均不可见；超级管理员没有跨组织的技能总览。

## 核心决策

### 1. 三档权限模型（Read / Write / Manage）

- 技能授权档位统一为 **Read / Write / Manage** 三档。
- **个人授权**（Gitea Collaborator）与**团队授权**（Gitea Team +
  Team-Repo 关联）均支持三档；Manage 映射 Gitea 的 admin 级权限。
- 默认全员团队 `all-readers`（Read）与 `all-writers`（Write）保持不变，
  **不设全员 Manage 团队**——全员管理权没有合理治理场景。

### 2. 管理权（Manage Permission）语义

管理权 = 修改 Server-hosted Skill Source + 发布 Skill Release + 配置技能
权限（共享与授权）+ 授予/撤销他人的管理权。持有者即该技能的 Maintainer。

- 技能创建者自动成为初始 Maintainer（现状保持）。
- 管理权可授予组织成员或 Organization Team，也可被持有管理权者或组织
  管理员撤销。
- 权限事实来源维持 Gitea：管理权判定（`canManageSkill`）以 Gitea 的
  admin 级 collaborator/team 授权为准；本地 `maintainers_json` 退化为
  初始创建者记录，不再作为授权依据扩展。

### 3. publish 守门统一

发布（`publish`）的鉴权从"仅 `maintainers` 列表成员"统一为管理权判定
（`canManageSkill`：owner、管理权持有者、`<org>_admin`）。行为变化：
owner 与组织管理员此后也可以 publish。

### 4. 角色化技能可见性

| 角色 | 可见范围 | 权限配置入口 |
|---|---|---|
| 超级管理员 | 跨组织全部技能（含未发布），只读浏览为主 | 可进任意技能的权限面板 |
| 组织管理员 | 本组织全部技能（含未发布） | 本组织任意技能 |
| 普通成员 | "我管理的技能"页两个视图：**我管理的** / **共享给我的**（可读或可写但无管理权，含未发布） | 仅自己持有管理权的技能 |

- 成员页"我的技能"更名为**"我管理的技能"**：集合语义从"我创建的"
  （`createdBy`）改为"我持有管理权的"（管理权判定）。
- "共享给我的"包含未发布的技能：可见性跟随读权限，与生命周期状态
  （是否已发布）正交。

### 5. upload 默认权限维持私有（不因本 ADR 改变）

维持 ADR-0016 的默认策略：Source Upload 创建私有技能，仅上传者可访问。
"组织全员可读"由持有管理权者显式执行 `share_all_read`（将技能仓库关联
至自动维护的 `all-readers` 团队）达成，不引入隐式组织默认或"私有"标记
例外。

## 影响与后果 (Consequences)

1. `hasReadAccess` 需补超级管理员判定；非 active 组织（冻结/删除中）的技能
   对平台管理员保留治理可见性——组织激活门禁对平台管理员放行，其余调用方
   照旧拒绝。
2. `/api/skills/search` 仅返回 `published` 技能，无法支撑"含未发布"的
   三个角色视图，需要新的列表查询（按管理权/读权限/创建者过滤）。
3. `add_team` / `add_member` 权限操作扩展到三档；`share_all_write` 之上
   不新增"全员管理"快捷操作。
4. Web 端改动：成员页更名并增加"我管理的 / 共享给我的"两个视图；超管
   控制台新增跨组织技能列表页；权限面板（`SkillPermissionsPanel`）扩展
   Manage 档位。
5. CONTEXT.md 的 **Maintainers** 与 **Organization Team** 词条已随本 ADR
   同步修订（管理权语义；团队访问级别 Read/Write/Manage）。
