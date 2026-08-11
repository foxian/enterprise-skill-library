# 07 — Final verification and regression coverage

**What to build:** Complete the regression pass for Adapt Manifest owned cleanup. Confirm that the whole-directory deletion failure mode is covered, the ADR and domain language are reflected in behavior, and the repository checks pass.

**Blocked by:** 01 — Stop normal adapt from cleaning tool skill roots; 02 — Record adapted outputs in an Adapt Manifest; 03 — Adopt or reject existing unmanifested targets safely; 04 — Add explicit prune for manifest-owned stale output; 05 — Report skipped and conflicted cleanup outcomes; 06 — Wire CLI prune option and safe empty-store behavior.

**Status:** ready-for-agent

- [ ] Tests prove normal adapt does not delete unrelated AI tool skill directories.
- [ ] Tests prove prune never deletes unmanifested directories.
- [ ] Tests prove identity verification protects reused stale-output paths.
- [ ] No normal adapt code path performs whole-root tool skill cleanup.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
