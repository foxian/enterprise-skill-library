# 07 — Rename-aware Update Migration

**What to build:** 已安装技能改名后，用户执行 `update` 可以根据稳定 Skill ID 自动迁移本地安装状态，而不会产生第二个技能或破坏固定旧版本。

**Blocked by:** 04 — Published Package Install 与 Compatibility；06 — Skill Rename 与 Git 地址迁移

**Status:** ready-for-agent

- [ ] lockfile 中存在 Skill ID 时，`update` 能识别当前 Identity 与服务器 Identity 已发生 rename。
- [ ] `update` 先准备并校验新 Identity 的 Published Skill Package，再原子迁移本地目录。
- [ ] 项目依赖键、lockfile Identity、物理目录和适配输出同步迁移到新名称。
- [ ] 迁移成功后旧目录、旧依赖键和旧适配输出被清理；迁移失败时旧安装仍可用。
- [ ] 固定历史旧 Release 不因 rename 被重新打包或强制迁移。
- [ ] CLI、Core 和端到端测试覆盖 rename 后 update、失败回滚、锁文件升级和适配清理。
