# 06 — Contract Old Registry And Git Base Surface

**What to build:** Remove the old Registry API and Git Backend configuration surface so the client model only exposes the ESL Server URL.

**Blocked by:** 03 — Move Non-Git API Commands To ESL Server; 05 — Move Git Workflow Commands To Clone URLs.

**Status:** resolved

- [ ] User-facing command options no longer expose `--registry`.
- [ ] User-facing command options no longer expose `--git-base`.
- [ ] Client configuration no longer stores `registry` or `gitBase`.
- [ ] Tests and fixtures use `server` vocabulary unless they intentionally describe historical documentation.
- [ ] Error messages and help text refer to the ESL Server rather than the Registry API as the configured service.
- [ ] `npm test` passes without compatibility behavior for old `registry` or `gitBase` settings.
