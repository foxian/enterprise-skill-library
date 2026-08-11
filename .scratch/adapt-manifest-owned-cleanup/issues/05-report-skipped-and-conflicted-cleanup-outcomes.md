# 05 — Report skipped and conflicted cleanup outcomes

**What to build:** Adapt results and CLI formatting should report ownership and cleanup outcomes clearly. Users should be able to distinguish synced, adopted, pruned, skipped, and conflicted outputs.

**Blocked by:** 03 — Adopt or reject existing unmanifested targets safely; 04 — Add explicit prune for manifest-owned stale output.

**Status:** ready-for-agent

- [ ] Core adapt results distinguish synced outputs from adopted outputs.
- [ ] Core adapt results include pruned outputs when prune runs.
- [ ] Core adapt results include skipped outputs when prune refuses to delete.
- [ ] Core adapt results include conflicts when adapt refuses to overwrite.
- [ ] CLI output summarizes each outcome without hiding skipped or conflicted entries.
