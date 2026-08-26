# 04 — Published Package Install 与 Compatibility

**What to build:** Skill User 执行 `install` 时下载并安装 Published Skill Package，而不是 clone 源码；安装得到稳定的 Namespace 化目录、清单和适配输入。

**Blocked by:** 03 — Skill Release 与 Published Skill Package

**Status:** ready-for-agent

- [ ] `install` 对没有 Release 的技能、Active Unreleased Skill Source 和不可安装状态返回明确错误。
- [ ] 远程 `install` 只消费 Published Skill Package，不直接 clone Git 源码仓库。
- [ ] 安装包包含服务器生成的 `skill.json`，其中包含 Skill Identity、Skill ID、Release version、source commit、checksum 和 Release Manifest 快照。
- [ ] 项目依赖键保持 `@namespace/skill-name`，物理目录使用 `namespace_skill-name`。
- [ ] 安装包中的 `SKILL.md.name` 使用 `namespace:skill-name`，源码中的 `SKILL.md.name` 保持短名。
- [ ] compatibility 默认阻止不兼容安装；显式绕过时覆盖完整依赖树，逐项输出警告并在 lockfile 中记录。
- [ ] 现有 adapt 流程消费通用 Namespace 化发布包，不在 publish 阶段生成工具专用包。
- [ ] CLI、Core 和端到端测试覆盖包下载、checksum 校验、目录布局、生成清单、兼容性阻断和绕过行为。
