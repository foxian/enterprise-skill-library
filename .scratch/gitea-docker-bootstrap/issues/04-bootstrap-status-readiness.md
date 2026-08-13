# 04 - Bootstrap status reports real readiness

Type: task
Status: ready-for-agent

**What to build:** Extend `esl admin bootstrap status` so it reports Gitea,
admin-token, and repository-owner readiness.

**Blocked by:** 01, 02

**Acceptance criteria:**

- [ ] Status response distinguishes Gitea readiness.
- [ ] Status response distinguishes Gitea administrator token readiness.
- [ ] Status response distinguishes repository-owner readiness.
- [ ] Overall `ready` is false when any required dependency is missing or
  invalid.
- [ ] CLI output remains clear for humans.
- [ ] The response remains machine-checkable for automation.
