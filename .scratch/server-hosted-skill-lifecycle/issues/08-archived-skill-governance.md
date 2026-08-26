# 08 — Archived Skill Governance

**What to build:** Owner 或管理员可以显式归档技能，Archived 技能停止新的源码修改和 Release 创建，但历史数据仍可恢复和查询。

**Blocked by:** 03 — Skill Release 与 Published Skill Package；06 — Skill Rename 与 Git 地址迁移

**Status:** ready-for-agent

- [ ] Active Unreleased Skill Source 不会因为未发布自动进入 Archived。
- [ ] Archived 技能不出现在默认搜索结果，不能接受新的源码 push，也不能创建新 Release。
- [ ] 历史 Skill ID、Git 历史、Release、Published Skill Package、安装记录和重定向继续保留。
- [ ] 物理删除在第一版不可用，包括从未发布但已上传的技能。
- [ ] 只有 ESL Platform Administrator 可以 restore Archived Skill。
- [ ] restore 后保留原 Skill ID、Identity、Maintainer、Release 历史和重定向关系。
- [ ] Server、CLI、Git Backend 和端到端测试覆盖 archive、restore、权限和历史数据保留。
