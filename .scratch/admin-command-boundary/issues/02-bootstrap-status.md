# 02 — Admin can check bootstrap readiness

**What to build:** `esl admin bootstrap status` reports whether the runtime is ready and uses the saved client registry by default, with explicit override only when needed.

**Blocked by:** 01 — Docker runtime bootstraps internal Gitea backend

**Status:** resolved

- [x] The command reports a clear ready / not-ready result for the platform administrator.
- [x] The command reads the registry from client configuration unless a command-line override is supplied.
