# 01 — Release Manifest v2：version 必填

**What to build:** `release.json` 成为 Skill Release 版本号的事实来源——新增必填 `version` 字段，schema 升到 `schemaVersion: 2`，并收紧 SemVer 校验口径。

**Blocked by:** 无（ADR-0030 的前置项）

**Status:** ready-for-agent

- [ ] `ReleaseManifestSchema`（`packages/core/src/schema/release-manifest.ts`）增加 `version` 必填字段，`schemaVersion` 字面量从 `1` 改为 `2`。
- [ ] SemVer 校验拒绝 build metadata（`1.0.0+abc` 不合法），与 `skill.json` 的 `SemVerSchema`（`packages/core/src/schema/skill-json.ts`）口径一致。
- [ ] `createMinimalReleaseManifest(license)` 生成带 `version: "0.1.0"` 的最小清单。
- [ ] `validateSkillSourceDirectory` 遇到 `schemaVersion: 1`（无 `version`）的清单时，报错信息指路 `esl version <SemVer>` 补写版本。
- [ ] `SKILL.md` frontmatter 仍不含 `version`，其 `.strict()` 校验不接受该字段。
- [ ] core 测试更新：v2 清单通过、v1 清单报错指路、build metadata 被拒、最小清单含 `version: "0.1.0"`。
