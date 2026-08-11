# 01 — Adapt project skills with namespaced runtime identity

**What to build:** Project adapt should generate copied runtime snapshots that preserve namespace information. A project skill with Skill Identity `@namespace/skill-name` should adapt into a one-level AI tool directory named `namespace_skill-name`, and its adapted `SKILL.md` frontmatter should use `name: namespace:skill-name`. Skills with the same short name in different namespaces should coexist without overwrite.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Project adapt writes adapted skills under the Adapted Skill Directory Name, not the short skill name.
- [ ] Project adapt rewrites the adapted `SKILL.md` frontmatter `name` to the Adapted Skill Display Name.
- [ ] `@local/skill-name` adapts with the `local` namespace in both the directory name and display name.
- [ ] Two project skills with the same short name but different namespaces adapt into separate runtime directories.
- [ ] Adapted output remains a copied runtime snapshot, not a link to the project skill store.
