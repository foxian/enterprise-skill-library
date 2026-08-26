# 05 — Release Update 与依赖版本锁定

**What to build:** 已安装的 Published Skill Package 可以安全更新到新的 Skill Release，同时固定旧 Release 永远保持原样，依赖解析不会随时间漂移。

**Blocked by:** 04 — Published Package Install 与 Compatibility

**Status:** ready-for-agent

- [ ] `update` 只选择已发布的更高 Release，不把源码 push 或源码新提交直接视为可安装更新。
- [ ] `.skills-lock.json` 记录 Skill ID、当前 Identity、Release version、package URL 和 integrity。
- [ ] Release Dependency Lock 固定每个传递依赖的 Skill ID、Release version 和 checksum。
- [ ] 同一个 Release 在不同时间安装得到相同依赖图和相同包内容。
- [ ] 固定旧 Release 的安装不会被 update 或重新发布改变。
- [ ] 已存在的 SemVer 只能查询或执行安全的 Tag repair，不能重新生成包或替换 Release。
- [ ] CLI、Core、Server 和端到端测试覆盖更新、锁文件、固定版本复现和依赖稳定性。
