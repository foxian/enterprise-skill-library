# 03 — Skill Release 与 Published Skill Package

**What to build:** Maintainer 可以从已同步到服务器的当前源码创建不可变 Skill Release 和 Published Skill Package，发布版本可被 Registry 发现但不会覆盖源码或既有版本。

**Blocked by:** 01 — Source Manifest 与源码契约；02 — Source Collaboration 与 Maintainer 权限

**Status:** ready-for-agent

- [ ] `publish <version>` 必须在 Skill Source Git 工作区执行，工作区干净，且当前本地 `HEAD` 等于已经存在于 ESL Source Remote 的 `esl/main`。
- [ ] `publish` 只读取当前 `HEAD`，不隐式 push 源码分支；第一版不支持从任意历史 commit 创建新 Release。
- [ ] SemVer 只由 `publish <version>` 提供；源码和 `release.json` 不保存 Skill Release 版本。
- [ ] 服务器从目标源码 commit 读取并校验 `release.json`，发布参数不能覆盖清单内容。
- [ ] 同一 Skill ID 下重复 SemVer 被拒绝；已有 Release、Package bytes 和 Release metadata 不被覆盖或删除。
- [ ] Release 绑定 Skill ID、SemVer、source commit、Published Skill Package checksum 和 Release Manifest 快照。
- [ ] 发布时解析远程已发布依赖并保存 Release Dependency Lock；直接或间接循环依赖被拒绝。
- [ ] 服务器生成不可变 Published Skill Package，并生成其中的 Package Manifest `skill.json`。
- [ ] Release 成功后由服务器通过 Git Backend 创建并推送 annotated `v<SemVer>` Release Tag；缺失 Tag 可在 commit 一致时修复，冲突 Tag 被拒绝。
- [ ] 已发布技能进入 Registry 发现和 Release 查询流程；Active Unreleased 与 Archived 技能不能创建新 Release。
- [ ] Server 与 CLI 测试覆盖干净工作区、`esl/main` 校验、无隐式源码 push、版本唯一性、包不可变性、依赖锁定和 Release Tag。
