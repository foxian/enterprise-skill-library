# 02 — Source Collaboration 与 Maintainer 权限

**What to build:** Skill User 可以通过 `source` 获取 Server-hosted Skill Source，Maintainer 可以用正常 Git 工作流更新源码，其他用户可以协作下载但不能修改。

**Blocked by:** 01 — Source Manifest 与源码契约

**Status:** ready-for-agent

- [ ] 首次 `upload` 添加名为 `esl` 的 Git remote，不覆盖已有 `origin`。
- [ ] `source` 默认获取服务器源码仓库的 `main`，并支持显式 Git ref 或历史 Skill Release。
- [ ] 所有已登录 Skill User 可以按明确 Identity 或 Skill ID 下载 Active Unreleased Skill Source。
- [ ] Maintainer 的 Git push 被接受并保留可追溯源码历史；非 Maintainer 的 push 被拒绝。
- [ ] 普通 Git push 不创建 Skill Release，也不改变 Published Skill Package。
- [ ] 每次接收源码更新时校验 `SKILL.md.name` 与服务器登记 Identity 的短名一致。
- [ ] Server、CLI、Git Backend 测试覆盖跨用户 source、权限拒绝、源码更新和远程配置。
