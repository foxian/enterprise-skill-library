# 06 — Skill Rename 与 Git 地址迁移

**What to build:** Owner 或 Maintainer 可以通过显式 rename 流程修改技能公开名称，服务器、源码、Git 仓库和历史 Identity 保持一致且可追溯。

**Blocked by:** 01 — Source Manifest 与源码契约；02 — Source Collaboration 与 Maintainer 权限

**Status:** ready-for-agent

- [ ] 普通 Git push 修改 `SKILL.md.name` 被拒绝，并提示使用显式 rename。
- [ ] `rename` 保持 Skill ID、Release 历史和 Published Skill Package 不变。
- [ ] `rename` 同步源码 `SKILL.md` 短名、服务器当前 Skill Identity、Git Backend 仓库名称和 Git 映射。
- [ ] 旧 Identity 永久重定向到同一 Skill ID，旧 Identity 不得被其他技能复用。
- [ ] 使用旧 Identity 的普通安装请求明确提示 rename，不静默安装新 Identity 的 latest Release。
- [ ] 用户显式指定历史旧 Release 时仍可安装对应 Published Skill Package。
- [ ] rename 与 Git Backend、数据库更新之间具备失败补偿或可重试状态，不留下静默半完成变更。
- [ ] Server、Git Backend、CLI、Core 测试覆盖权限、冲突名称、仓库改名、重定向和历史版本行为。
