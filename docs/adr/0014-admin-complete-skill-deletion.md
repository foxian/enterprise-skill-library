# 管理员完全删除技能

Status: accepted

系统最初（CONTEXT "Archived Skill"）规定"初期不允许物理删除"，只提供保留式的 Archive/Restore。但运营上存在需要**彻底清理**的场景（错误注册、废弃技能占用名字、测试残留），且此前只有绕过产品、手工操作 Gitea API + 数据库的删除方式。我们决定提供正式的**管理员完全删除**操作：物理、不可恢复，与 Archived 的保留式停用相对。

具体决策如下：

- **服务端端点**：`POST /api/skills/:scope/:skillName/delete`，仅 ESL Platform Administrator 可调用（复用 `authorizePlatformAdministrator`，与 restore 一致）。删除顺序为：best-effort 删 Gitea 仓库（失败不阻断）→ 删 Published Skill Package 目录（`packageRoot/<skillId>`）→ 删 DB 全部关联记录。Gitea 删除失败可能残留孤儿仓库，但记录与产物仍被清除。
- **DB 全量清理**：`SkillRepository.deleteSkill(name)` 在事务内删除 `skills`、`skill_releases`、`skill_versions`、`skill_tags`、`skill_identity_redirects`（按 skillId 与新旧名称匹配）关联行，返回被删 release 数。
- **CLI 双重确认**：`esl delete <skill-identity>` 默认要求**两次确认**——先显式 y/N，再手动输入完整 Skill Identity 才放行，杜绝 `echo y` 误触发；`--yes` 显式跳过交互。非管理员（普通 Skill User token）被服务端 403 拒绝。
- **服务端 confirm 护栏**：删除请求体必须携带 `confirm: "<完整 Skill Identity>"` 且与服务端记录一致，否则 400——即使持有管理员 token 的脚本/误调也不能随手删错。
- **不可逆与不可复用**：删除后 Skill Identity 不可用、不可重新上传同名（服务端按名字登记，被删即释放——这是刻意的：删除即彻底释放）。CONTEXT 新增 Deleted Skill 词条。

## Considered Options

- **Archive 够用**：归档保留数据、可恢复，但不释放名字、不清磁盘，无法满足"彻底清理"需求——被弃。
- **软删除（标记 + 物理清理延迟）**：引入更多状态与回收流程，收益低——被弃，直接物理删除并强制管理员确认更简单清晰。

## Consequences

- 完全删除是**不可恢复**的；因此严格限定平台管理员 + 显式确认。
- Gitea 仓库删除为 best-effort，失败残留孤儿仓库需运维侧处理。
- 与 ADR-0007 的"Published Skill Package 不可删除"不再冲突——该约束针对常规生命周期，管理员删除是治理兜底路径。
