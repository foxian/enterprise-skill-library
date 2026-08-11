# 04 — Add explicit prune for manifest-owned stale output

**What to build:** Adapt should support an explicit prune mode that removes stale outputs recorded in the Adapt Manifest. Prune must only delete manifest-owned stale outputs after verifying that the target still matches the recorded identity.

**Blocked by:** 02 — Record adapted outputs in an Adapt Manifest.

**Status:** ready-for-agent

- [ ] Prune identifies stale outputs from the Adapt Manifest that no longer correspond to current store skills.
- [ ] Prune deletes a stale output only when identity verification succeeds.
- [ ] Prune skips stale outputs whose target identity verification fails.
- [ ] Prune does not delete directories that are not recorded in the Adapt Manifest.
- [ ] Normal adapt without prune still leaves stale output untouched.
