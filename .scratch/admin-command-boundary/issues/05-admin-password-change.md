# 05 — Admin can change own password

**What to build:** `esl admin password change` lets the current platform administrator update their own password while keeping CLI authentication token-based.

**Blocked by:** 01 — Docker runtime bootstraps internal Gitea backend; 02 — Admin can check bootstrap readiness

**Status:** resolved

- [x] The current platform administrator can change their own password from ESL.
- [x] The CLI continues to use tokens by default after the first bootstrap login.
