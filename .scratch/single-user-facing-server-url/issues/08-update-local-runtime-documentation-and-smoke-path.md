# 08 — Update Local Runtime Documentation And Smoke Path

**What to build:** Local runtime documentation and smoke instructions teach the single ESL Server URL workflow and stop instructing users to configure separate API and Git Backend addresses.

**Blocked by:** 06 — Contract Old Registry And Git Base Surface; 07 — Expose One Local Docker ESL Server URL.

**Status:** resolved

- [ ] Local development documentation uses `--server http://localhost:3000` in CLI examples.
- [ ] Docker setup documentation describes one default ESL Server URL.
- [ ] Documentation no longer tells normal users to pass `--git-base`.
- [ ] Documentation no longer treats the Git Backend host port as part of the normal workflow.
- [ ] Smoke instructions verify login, administration, publish or install behavior through the single ESL Server URL.
- [ ] The final verification guidance includes `npm test` and `npm run build`.
