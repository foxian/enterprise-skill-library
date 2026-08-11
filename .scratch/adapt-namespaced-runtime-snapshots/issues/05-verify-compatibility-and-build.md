# 05 — Verify compatibility and build

**What to build:** Complete the integration pass for namespaced adapted runtime snapshots. Confirm backward compatibility expectations, ensure the adapted naming vocabulary is consistently reflected in behavior, and run the repository's standard verification commands.

**Blocked by:** 01 — Adapt project skills with namespaced runtime identity; 02 — Adapt global skills with namespaced runtime identity; 03 — Show adapt source-to-runtime mappings in CLI output; 04 — Update import and install adapt expectations.

**Status:** ready-for-agent

- [ ] Existing short-name skill packages remain valid where compatibility is required.
- [ ] Validator expectations are updated only as needed for the new adapted naming behavior.
- [ ] No unsupported link, symlink, junction, hard-link, or live-view adapt behavior is introduced.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
