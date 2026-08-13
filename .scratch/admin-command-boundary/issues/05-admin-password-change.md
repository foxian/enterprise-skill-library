# 05 — Admin can rotate Gitea administrator password

**What to build:** `esl admin gitea password` lets the current platform administrator rotate the Gitea administrator password used for backend recovery and maintenance while keeping CLI authentication token-based.

**Blocked by:** 01 — Docker runtime bootstraps internal Gitea backend; 02 — Admin can check bootstrap readiness

**Status:** resolved

- [x] The current platform administrator can rotate the Gitea administrator password from ESL.
- [x] The CLI continues to use tokens by default after the first bootstrap login.
