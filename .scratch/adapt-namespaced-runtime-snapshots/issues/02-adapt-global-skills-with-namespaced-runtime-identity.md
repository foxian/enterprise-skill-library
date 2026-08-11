# 02 — Adapt global skills with namespaced runtime identity

**What to build:** Global adapt should use the same namespace-aware runtime identity rules as project adapt. Skills installed in the global skill store should adapt into copied AI tool runtime snapshots named with Adapted Skill Directory Name, with adapted `SKILL.md` frontmatter using Adapted Skill Display Name.

**Blocked by:** 01 — Adapt project skills with namespaced runtime identity.

**Status:** ready-for-agent

- [ ] Global adapt writes adapted skills under `namespace_skill-name` runtime directories.
- [ ] Global adapt rewrites adapted `SKILL.md` frontmatter to `name: namespace:skill-name`.
- [ ] `@local/skill-name` in the global skill store adapts with the `local` namespace preserved.
- [ ] Project and global adapt share the same externally visible naming behavior.
- [ ] Global adapted output remains a copied runtime snapshot, not a link to the global skill store.
