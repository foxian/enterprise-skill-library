# 03 — Adopt or reject existing unmanifested targets safely

**What to build:** When an adapted target directory already exists but is not recorded in the Adapt Manifest, adapt should make an ownership decision based on identity. Matching targets can be adopted and overwritten; non-matching targets must be reported and left untouched.

**Blocked by:** 02 — Record adapted outputs in an Adapt Manifest.

**Status:** ready-for-agent

- [ ] Adapt adopts an unmanifested target when its identity matches the current Skill Identity or Adapted Skill Display Name.
- [ ] Adopted targets are recorded in the Adapt Manifest.
- [ ] Adapt reports a conflict when an unmanifested target identity does not match.
- [ ] Conflicted targets are not overwritten or deleted.
- [ ] Conflict behavior is covered for project adapt and at least one global/tool path.
