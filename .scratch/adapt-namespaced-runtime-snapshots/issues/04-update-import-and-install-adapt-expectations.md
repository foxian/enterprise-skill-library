# 04 — Update import and install adapt expectations

**What to build:** Import and install flows that trigger adapt should expect the new namespace-aware runtime output. When a user imports or installs a skill and adapt runs automatically, the generated AI tool directory and adapted `SKILL.md` should follow the same Adapted Skill Directory Name and Adapted Skill Display Name rules as direct adapt.

**Blocked by:** 01 — Adapt project skills with namespaced runtime identity.

**Status:** ready-for-agent

- [ ] Import flows that auto-run adapt generate `namespace_skill-name` runtime directories.
- [ ] Install flows that auto-run adapt generate `namespace_skill-name` runtime directories.
- [ ] Auto-adapted `SKILL.md` frontmatter uses `name: namespace:skill-name`.
- [ ] Existing no-adapt behavior remains unchanged.
- [ ] Dependency records and store layout continue to use Skill Identity.
