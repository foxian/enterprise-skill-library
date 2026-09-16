# 分级技能删除与身份释放实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Server-hosted Skill 建立 Archive → Delete 两阶段删除、分级 Restore/Delete 权限、Deleting Workflow、独立删除审计与 Web 生命周期入口，并在删除后释放 Skill Identity 名称。

**Architecture:** 保持 CLI 不新增 `esl delete`，在 Server DB 中扩展 deletion 状态与审计表；权限判定集中在 `skills.ts` helper；删除先置为 `deleting`，依次清理 Gitea 仓库与发布包，最终事务删除 DB 数据并写入不依赖 `skills` 外键的审计记录；Web 在共用 `SkillManagePanel` 暴露生命周期操作。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vue 3 + Element Plus, Vitest。

## Global Constraints

- 只实现 Server-hosted Skill 整技能删除；不恢复 `esl delete` CLI。
- “未发布”的唯一判断是 `skill_releases` 中是否存在行，包括已删除 Release tombstone。
- Archive 使用现有 `manage` 权限；Restore 权限镜像 Delete 权限。
- Delete/Restore：从未发布技能允许 `manage`；曾发布组织技能允许平台管理员或组织 Owners 成员；曾发布个人技能允许平台管理员或 owner/creator。
- 依赖方不阻断删除，但 delete-context 和审计都必须记录依赖方。
- 删除请求必须提供非空 `reason`，且 `confirm` 必须精确等于完整 Skill Identity。
- 删除成功后同名可重新注册为新 Skill；不保留 Identity 连续性。
- 不提交用户既有未提交改动；本次完成后保持改动未提交。
- 最终必须运行 `npm test` 与 `npm run build`。
- CLI 错误文案变化必须同步 `skills/esl-operator/`。

---

### Task 1: 数据库模型与 Repository 语义

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Modify: `packages/server/src/db/database.ts`
- Test: `packages/server/tests/database.test.ts`

**Interfaces:**
- Produces: `hasEverPublished(skillName: string): boolean`
- Produces: `findSkillDependents(skillId: string): string[]`
- Produces: `beginSkillDeletion(input: { name: string; requestedBy: string; reason: string }): void`
- Produces: `markSkillDeletionFailed(name: string, error: string): void`
- Produces: `getDeletionMetadata(name: string): SkillDeletionMetadata | undefined`
- Produces: `deleteSkillWithAudit(input: SkillDeletionAuditInput): { skillId?: string; releases: number }`
- Produces: `SkillRecord` 增加 `deletionRequestedBy?`, `deletionReason?`, `deletionError?`, `deletionRequestedAt?`

- [ ] 在 `skills` schema 增加 `deletion_requested_by`, `deletion_reason`, `deletion_error`, `deletion_requested_at`，并同步 `initDatabase` / `ensureColumn` 迁移。
- [ ] 新增独立审计表：

```sql
CREATE TABLE IF NOT EXISTS skill_deletion_audits (
  skill_id TEXT,
  full_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  releases_removed INTEGER NOT NULL,
  dependents_json TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] Repository 实现上述方法。`restoreSkill(name, everPublished)` 将曾发布技能恢复为 `active-published`，从未发布恢复为 `active-unreleased`。最终删除事务删除 releases、versions、tags、redirects、skills，并在同一事务插入 audit。
- [ ] `findSkillDependents` 遍历活跃 releases 的 `dependency_lock_json`，按 `entry.skillId` 匹配并去重。

**Verification:** 新增/更新 database tests 覆盖 tombstone 判定、restore 状态、failed metadata、audit 插入与依赖方汇总。

### Task 2: 分级权限与 Delete Context API

**Files:**
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/web/src/skills/skill-list.ts`
- Test: `packages/server/tests/delete-api.test.ts`

**Interfaces:**
- Consumes: Task 1 Repository 方法。
- Produces: `canDeleteWholeSkill(skill, username, isPlatformAdmin): Promise<boolean>`
- Produces: `canRestoreSkill(skill, username, isPlatformAdmin): Promise<boolean>`
- Produces: `GET /api/skills/:scope/:skillName/delete-context`
- Produces: `SkillContext.everPublished: boolean`
- Produces: `SkillContext.deletionError?: string | null`
- Produces: `DeleteContextResponse { name, everPublished, releasesRemoved, dependents: string[] }`

- [ ] 新增 helper：

```ts
async function canDeleteWholeSkill(skill: SkillRecord, username: string, isPlatformAdmin: boolean) {
  if (isPlatformAdmin) return true;
  if (!repository.hasEverPublished(skill.name)) return await canManageSkill(giteaService, skill, username);
  if (skill.owner === username || skill.createdBy === username) return true;
  return await isOwnerMemberOf(giteaService, skill.scope, username);
}
```

`canRestoreSkill` 直接复用同一权限函数；个人/组织语义一致。

- [ ] 修改 `/restore` 从平台管理员守门改为 `canRestoreSkill`，并按 `repository.hasEverPublished(name)` 恢复正确状态。
- [ ] 修改 `/delete`：要求 skill 已处于 `archived` 或 `delete_failed`；校验 `confirm` 与 `reason`；先调用 `beginSkillDeletion`。
- [ ] 新增 `/delete-context`：删除权限用户可访问，返回 `everPublished`、将被移除的 release 数量、`findSkillDependents` 结果。

**Verification:** API tests 覆盖权限矩阵、reason/confirm 校验、context、未发布/已发布区分、restore 权限与状态。

### Task 3: Deleting Workflow 与审计

**Files:**
- Modify: `packages/server/src/routes/skills.ts`
- Modify: `packages/server/src/db/database.ts`
- Test: `packages/server/tests/delete-api.test.ts`

**Interfaces:**
- Consumes: `beginSkillDeletion`, `markSkillDeletionFailed`, `deleteSkillWithAudit`。
- Produces: 可重试同步删除流；失败状态 `delete_failed`，成功后 skill 记录消失且 audit 独立保留。

- [ ] 删除流程顺序：
  1. 校验与权限。
  2. `beginSkillDeletion`，状态置 `deleting`。
  3. `giteaService.deleteRepo(repo.owner, repo.name)`；失败捕获后 `markSkillDeletionFailed` 并返回 409。
  4. `fs.rm(packageRoot/skillId, { recursive: true, force: true })`；失败同上。
  5. 收集依赖方与 release 数。
  6. `deleteSkillWithAudit` 在 DB 事务中完成删除与审计。
- [ ] 重复调用允许从 `archived` 或 `delete_failed` 重试；响应错误包含服务端保存的 deletion error。
- [ ] audit 表无 `skills` 外键，技能删除后审计记录必须仍存在。

**Verification:** 模拟 Gitea 失败后状态为 `delete_failed`；修复 fake 后重试成功；验证 audit 行、Gitea 调用、包目录移除和 GET 404。

### Task 4: Web 生命周期入口

**Files:**
- Modify: `packages/web/src/skills/skill-list.ts`
- Modify: `packages/web/src/components/SkillManagePanel.vue`
- Test: `packages/web/tests/skill-lifecycle.test.ts`

**Interfaces:**
- Consumes: permissions response 与 `/delete-context`。
- Produces: `archive-skill`, `restore-skill`, `delete-skill`, `delete-context`, `delete-confirm-input`, `delete-reason-input` 测试钩子。
- Produces: `DeleteContext` 类型与状态文案。

- [ ] `statusText` 支持：`active-published`/`published`=已发布，`active-unreleased`=未发布，`archived`=已归档，`deleting`=删除中，`delete_failed`=删除失败。
- [ ] `SkillContext` 增加 `everPublished?: boolean; deletionError?: string | null; visibility?: 'public' | 'private'`。
- [ ] 面板新增“生命周期”卡片：
  - active + manage：显示 Archive。
  - archived + 可 restore：显示 Restore。
  - archived/delete_failed + 可 delete：显示 Delete；`delete_failed` 同时显示 `deletionError`。
- [ ] Delete 对话流程调用 context，展示是否曾发布、将被移除的 release 数和依赖方；要求填写原因；要求完整身份确认；成功后 `ElMessage.success` 并跳转对应技能列表。
- [ ] 删除失败显示服务端错误并允许再次 Delete 重试。

**Verification:** 挂载测试通过 fake API 覆盖按钮可见性、确认输入、context 渲染、成功/失败提示。

### Task 5: CLI 文案与内置技能同步

**Files:**
- Modify: `packages/cli/src/commands/reset-source.ts`
- Modify: `skills/esl-operator/SKILL.md`
- Modify: `skills/esl-operator/references/author.md`
- Modify: `skills/esl-operator/references/setup.md`
- Modify: `packages/cli/tests/reset-source.test.ts`（如已有测试则更新）
- Test: CLI 相关 Vitest

**Interfaces:**
- Consumes: 无新 CLI 接口。
- Produces: `esl reset-source` 报错指引改为“未发布技能由管理权持有者删除；已发布技能由平台管理员或组织所有者删除”。

- [ ] 将文案中 `have it deleted (Archived/Deleted Skill by the platform administrator)` 更新为上述分级指引。
- [ ] 同步内置技能中平台管理员唯一删除权的表述，改为 Web 生命周期入口与两级权限说明。
- [ ] 明确删除入口只在 Web UI，不新增 CLI 命令。

**Verification:** 运行 CLI reset-source 相关测试；`Select-String` 确认无旧文案残留。

### Task 6: 领域文档与 ADR

**Files:**
- Create: `docs/adr/0040-tiered-skill-deletion-and-identity-release.md`
- Modify: `docs/adr/0014-admin-complete-skill-deletion.md`
- Modify: `CONTEXT.md`
- Modify: `docs/guides/usage.md`

**Interfaces:**
- Produces: ADR-0040 为 Deleted Skill、Identity 释放、分级删除权、Deleting Workflow 的权威说明。
- Produces: ADR-0014 状态为 Superseded by ADR-0040。

- [ ] ADR-0040 记录背景、决策、权限矩阵、依赖处理、audit、Gitea/Package/DB 失败与重试语义、Identity 释放。
- [ ] ADR-0014 只改 Status 与 Superseded 指针，不改写历史正文。
- [ ] `CONTEXT.md` 更新 Deleted Skill、Archived Skill、Deleting、Delete Failed、Skill Deletion Audit 术语。
- [ ] `docs/guides/usage.md` 补充 Web 入口、两阶段流程、确认输入、原因与恢复规则。

**Verification:** 通读文档，确认与 API 行为和测试一致。

### Task 7: 全量验证

**Files:** 无新增文件。

- [ ] 运行 `npm test`。
- [ ] 运行 `npm run build`。
- [ ] 检查 `git status --short`，只保留本次相关改动，不提交。

**Verification:** 两项命令通过；若存在与本任务无关的既有失败，单独说明且不盲目修复。
