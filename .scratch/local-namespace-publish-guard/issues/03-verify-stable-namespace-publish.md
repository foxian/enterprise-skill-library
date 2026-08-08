# 03 - Verify stable namespace publish remains unchanged

**What to build:** A user publishing a skill with a stable namespace, such as
`@cnfox/my-skill` or `@platform/my-skill`, still reaches the existing publish
flow. The local namespace guard must not reject non-local namespaces or change
the current mocked API and Git publish behavior.

**Blocked by:** 01 - Block publishing `@local/*` skills.

**Status:** ready-for-agent

- [ ] A valid non-local skill identity does not trigger the local namespace guard.
- [ ] A valid non-local skill identity still makes the expected API request in the publish flow.
- [ ] A valid non-local skill identity still executes the expected Git commands in the publish flow.
- [ ] The test uses mocked token, API, and Git execution rather than requiring a real logged-in user.
- [ ] The test suite and build pass after the guard and regression coverage are added.
