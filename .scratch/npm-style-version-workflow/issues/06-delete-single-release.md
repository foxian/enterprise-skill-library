# 06 — 单版本删除：外科手术式移除一个 Release

**What to build:** 版本级删除能力（ADR-0014 整技能删除的粒度细化）：Maintainer 可移除自己技能的一个坏版本，但依赖图引用与版本号复用都有硬约束。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 新增端点删除单个 Skill Release，移除四件套：Published Skill Package 文件、`skill_releases` 记录、`skill_versions` 条目、`v<SemVer>` Release Tag。
- [ ] **保留**源码 Git 历史、技能本身（Skill ID、仓库、重定向）与其余版本；不触碰用户本地已装副本。
- [ ] 执行权限：该技能的 Maintainer（Manage Permission）；未授权者拒绝。
- [ ] 依赖引用检查：扫描全部 `skill_releases.dependency_lock_json`，若有其他技能引用该版本则拒绝，并在报错中列出引用方。
- [ ] 被引用的版本仅 ESL Platform Administrator 可强制删除（依赖检查降为强警示，需显式确认）。
- [ ] 显式确认后方可执行（对齐 ADR-0014 的确认风格）。
- [ ] **版本号烧毁**：删除后保留 tombstone 记录，使同一版本号无法重新发布——注意不能只删 `skill_releases` 行，否则重复发布检查（409）会失效而放行重发。
- [ ] 删除后受影响技能的安装与 `update` 行为明确：`latest` 推导跳过已删版本，被依赖的版本删除后相关技能的安装解析报错可读。
- [ ] 操作写入审计记录。
- [ ] 测试覆盖：Maintainer 删除、依赖引用拒绝、平台管理员强删、tombstone 阻止重发、未授权拒绝。
