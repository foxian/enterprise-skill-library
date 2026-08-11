# 02 — Record adapted outputs in an Adapt Manifest

**What to build:** Project and global adapt should write an Adapt Manifest in the source store after generating adapted outputs. The manifest should record enough ownership information for later diagnosis and safe pruning.

**Blocked by:** 01 — Stop normal adapt from cleaning tool skill roots.

**Status:** ready-for-agent

- [ ] Project adapt writes an Adapt Manifest in the project source store.
- [ ] Global adapt writes an Adapt Manifest in the global source store.
- [ ] Manifest records include tool name, Skill Identity, Adapted Skill Directory Name, Adapted Skill Display Name, and target directory.
- [ ] Manifest records are refreshed when current skills are adapted.
- [ ] Normal adapt still does not delete stale manifest entries by default.
