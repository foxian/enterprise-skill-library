# 技能级团队权限模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将自定义团队改为无固定权限的逻辑团队，并通过三个内部权限团队实现逐技能 Read/Write/Manage 授权，同时完成 Q27 删除后的权限数据初始化。

**Architecture:** ESL 保存逻辑团队和技能团队授权，Git Backend 保存每个逻辑团队的 read/write/manage 三个内部团队。技能仓库只挂载当前技能选择的内部团队；个人授权仍使用仓库直接协作者；有效权限取全部来源最高值。初始化以幂等服务清理权限数据并重建固定组织团队，不迁移旧权限记录。

**Tech Stack:** TypeScript、Fastify、SQLite/better-sqlite3、Gitea REST API、Vue 3、Commander、Vitest。

## Global Constraints

- 所有用户可见文案、代码注释、文档和提交信息使用简体中文。
- 自定义团队不再接受或返回固定 `permission`。
- 固定团队 `all-readers`、`all-writers`、`all-managers` 与 Owners 保持现有组织语义。
- Q12 不做存量迁移；Q27 删除；初始化保留组织、账号、技能、源码和发布记录。
- 每个行为先写失败测试并确认失败，再写最小实现。
- 完成前必须运行 `npm test` 和 `npm run build`。

---

### Task 1: 增加逻辑团队与技能授权数据模型

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/database.ts`
- Create: `packages/server/src/services/skill-team-grants.ts`
- Test: `packages/server/tests/skill-team-grants.test.ts`

**Interfaces:**
- `SkillTeamGrantRepository.set(skillName: string, teamId: number, permission: 'read' | 'write' | 'manage'): void`
- `SkillTeamGrantRepository.remove(skillName: string, teamId: number): void`
- `SkillTeamGrantRepository.list(skillName: string): Array<{ teamId: number; permission: 'read' | 'write' | 'manage' }>`
- `SkillTeamGrantRepository.removeByTeam(teamId: number): void`
- `SkillTeamGrantRepository.clearAll(): void`

- [ ] **Step 1: Write the failing test**

测试同一团队可以在两个技能分别保存 `read`、`write`，同一技能重复设置只保留一行，
删除团队会移除全部技能授权。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/skill-team-grants.test.ts`

Expected: FAIL because the grant table and repository do not exist.

- [ ] **Step 3: Write minimal implementation**

新增 `skill_team_grants(skill_name, team_id, permission)`，以 `(skill_name, team_id)`
为主键；在数据库初始化中创建表；实现事务化 upsert、删除和全量清理。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/skill-team-grants.test.ts`

Expected: PASS.

### Task 2: 实现逻辑团队的三个内部权限团队投影

**Files:**
- Modify: `packages/server/src/services/org-team-model.ts`
- Create: `packages/server/src/services/logical-team-projection.ts`
- Modify: `packages/server/src/services/gitea.ts`
- Test: `packages/server/tests/logical-team-projection.test.ts`

**Interfaces:**
- `backendTeamName(teamKey: string, permission: 'read' | 'write' | 'manage'): string`
- `ensureLogicalTeamProjection(gitea: GiteaService, org: string, teamKey: string, members: string[]): Promise<Record<'read' | 'write' | 'manage', GiteaTeam>>`
- `syncLogicalTeamMembers(gitea: GiteaService, projection: ..., members: string[]): Promise<void>`
- `deleteLogicalTeamProjection(gitea: GiteaService, projection: ...): Promise<void>`

- [ ] **Step 1: Write the failing test**

验证创建逻辑团队投影会创建三个内部团队，成员会同步到三个团队，重复执行不会重复
创建；删除投影会删除三个内部团队。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/logical-team-projection.test.ts`

Expected: FAIL because projection helpers do not exist.

- [ ] **Step 3: Write minimal implementation**

使用稳定逻辑团队 key 生成后缀名，调用现有 Gitea team API 创建 read/write/admin 团队，
按三档同步成员；对缺失内部团队执行重建。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/logical-team-projection.test.ts`

Expected: PASS.

### Task 3: 修改组织团队 API 与生命周期

**Files:**
- Modify: `packages/server/src/routes/org-console.ts`
- Modify: `packages/server/src/services/organization-membership.ts`
- Test: `packages/server/tests/org-console.test.ts`

**Interfaces:**
- `POST /api/orgs/:orgName/teams` 接受 `{ name, display_name? }`
- `PATCH /api/orgs/:orgName/teams/:teamId` 接受 `{ name?, display_name? }`
- 响应只包含 `id`、`name`、`display_name`，不返回自定义团队固定 `permission`

- [ ] **Step 1: Write the failing test**

新增测试：不带 permission 可以创建团队；带 permission 返回 400；修改 permission 返回 400；
创建后存在三个内部权限团队；添加和移除成员同步三个内部团队；删除团队清理授权并删除三个
内部团队。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/org-console.test.ts`

Expected: FAIL because current routes require and mutate team permission.

- [ ] **Step 3: Write minimal implementation**

创建逻辑团队时使用固定的 backend 默认档位创建投影，数据库只保存显示名；编辑只允许
name/display_name；团队成员接口在逻辑团队层更新三组投影；删除前撤销 `SkillTeamGrant`
并删除三组投影。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/org-console.test.ts`

Expected: PASS for the new cases and existing organization identity cases.

### Task 4: 修改技能权限路由与权限计算

**Files:**
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/rbac-permissions.test.ts`
- Test: `packages/server/tests/org-skill-authority.test.ts`

**Interfaces:**
- `POST /api/skills/:scope/:skillName/permissions`
  - `{ action: 'set_team', team_id, permission }`
  - `{ action: 'remove_team', team_id }`
  - existing organization share and member actions remain supported
- Permission matrix returns logical teams with their selected per-skill permission and excludes
  backend projection teams.

- [ ] **Step 1: Write the failing test**

新增同一逻辑团队在两个技能分别设置 read/write；切换一个技能不影响另一个；矩阵返回
逻辑团队和档位；团队成员通过内部团队获得对应技能权限；全组织、团队和个人授权取最高值。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/rbac-permissions.test.ts packages/server/tests/org-skill-authority.test.ts`

Expected: FAIL because `add_team` currently mounts one team and derives permission from the
backend team's fixed permission.

- [ ] **Step 3: Write minimal implementation**

增加 team_id/permission 校验，按技能授权记录选择对应内部团队进行挂载；移除旧内部团队；
权限矩阵从逻辑团队授权记录生成；权限计算继续遍历仓库团队与协作者并取最高档位。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/rbac-permissions.test.ts packages/server/tests/org-skill-authority.test.ts`

Expected: PASS.

### Task 5: 更新 Web 团队管理和技能权限面板

**Files:**
- Modify: `packages/web/src/views/me/OrgTeamsView.vue`
- Modify: `packages/web/src/components/SkillManagePanel.vue`
- Modify: `packages/web/src/skills/skill-list.ts`
- Test: `packages/web/tests/org-console.test.ts`
- Test: `packages/web/tests/skill-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

验证创建团队表单不显示权限选择；团队列表不显示固定权限；技能团队授权可以选择 Read/Write/Manage；
请求体使用 `set_team`、`team_id`、`permission`，并能显示当前技能档位。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace @esl/web -- packages/web/tests/org-console.test.ts packages/web/tests/skill-permissions.test.ts`

Expected: FAIL because current UI submits team permission and `add_team`.

- [ ] **Step 3: Write minimal implementation**

删除团队固定权限表单、影响面提示和相关请求；技能面板增加团队权限选择器，使用逻辑团队
ID 授权，并把授权档位显示在矩阵中。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --workspace @esl/web -- packages/web/tests/org-console.test.ts packages/web/tests/skill-permissions.test.ts`

Expected: PASS.

### Task 6: 更新 CLI 与内置操作员技能

**Files:**
- Modify: `packages/cli/src/commands/share.ts`
- Modify: `packages/cli/src/bin/esl.ts`
- Modify: `skills/esl-operator/SKILL.md`
- Modify: `skills/esl-operator/references/author.md`
- Test: `packages/cli/tests/share.test.ts`

- [ ] **Step 1: Write the failing test**

验证 `esl share --team frontend --write` 生成 `set_team` 和 `permission: write`；不带档位时
默认为 read；帮助文本不再描述“继承团队固定权限”。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/cli/tests/share.test.ts`

Expected: FAIL because the current target omits permission for teams.

- [ ] **Step 3: Write minimal implementation**

为团队目标增加 read/write/manage 计算，发送 `team_id` 时兼容名称解析由服务端完成；
同步 CLI 帮助和 `skills/esl-operator/` 的共享语义。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/cli/tests/share.test.ts`

Expected: PASS.

### Task 7: 权限数据初始化与 seed 清理

**Files:**
- Create: `packages/server/src/services/permission-initialization.ts`
- Modify: `packages/server/src/seed.ts`
- Modify: `scripts/reset-dev-env.mjs`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/tests/permission-initialization.test.ts`

**Interfaces:**
- `initializePermissionData(gitea: GiteaService, dbPath: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

构造带有自定义团队、内部团队、技能团队挂载、个人协作者和旧授权记录的测试环境；
运行初始化后，验证权限相关数据清空，技能与 release 保留，固定组织团队和成员关系重建。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/permission-initialization.test.ts`

Expected: FAIL because no permission reset service exists.

- [ ] **Step 3: Write minimal implementation**

按组织遍历 Gitea 团队和技能仓库，删除自定义团队授权、内部投影团队、仓库团队挂载和
非 owner 协作者；清空 `skill_team_grants` 与团队 profile；重建固定组织团队及成员自动
加入关系。初始化过程按删除已不存在对象不报错设计，可重复运行。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/permission-initialization.test.ts`

Expected: PASS.

### Task 8: 全量验证与文档一致性

**Files:**
- Verify: `CONTEXT.md`
- Verify: `docs/glossary.md`
- Verify: `docs/adr/0037-skill-permission-is-per-skill-team-projection.md`
- Verify: `skills/esl-operator/`

- [ ] **Step 1: Search for obsolete fixed-team permission language**

Run: `rg -n "keeps the team permission level|团队.*固定.*权限|Team permission must|add_team|permission.*团队" CONTEXT.md docs packages skills`

Expected: only intentional compatibility references remain, with no user-facing old behavior.

- [ ] **Step 2: Run the required verification**

Run: `npm test`

Expected: exit code 0.

- [ ] **Step 3: Run the required build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check; git status --short`

Expected: no whitespace errors and only files related to this feature are modified.
