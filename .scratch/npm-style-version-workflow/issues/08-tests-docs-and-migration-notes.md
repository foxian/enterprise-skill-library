# 08 — 测试、文档与迁移说明收尾

**What to build:** 收掉 ADR-0030 带来的全部测试与文档欠账，去掉 walkthrough 的时效声明，并给出存量技能源的迁移口径。

**Blocked by:** 01、02、03、04、05、06、07

**Status:** ready-for-agent

- [ ] `docs/guides/skill-release-lifecycle.md` 移除顶部「实现落地前本文与 CLI 不一致」的时效声明，并对照实际行为复核第 3 / 5 / 6 节。
- [ ] `.scratch/server-hosted-skill-lifecycle/spec.md` 中「SemVer 只作 publish 参数、源码不携带版本」的约束加注指向 ADR-0030，避免后续读者按旧约束实现。
- [ ] `docs/glossary.md`（若与 CONTEXT.md 并存）同步 Release Manifest / Release Tag / 新增词条。
- [ ] 存量 Server-hosted Skill Source 的迁移口径写明：在其源码补写 `version` 并 push 后才能再次发布；已发布的历史 Release 不受影响。
- [ ] 受影响的既有测试全部更新（含 `packages/server/tests/app.test.ts` 的版本顺序断言、CLI `upload`/`publish` 测试、E2E 中依赖 `esl publish <version>` 的用例）。
- [ ] 全量 `npm run build` + 单元测试 + E2E 通过，且 walkthrough 按新流程人工走通一遍。
