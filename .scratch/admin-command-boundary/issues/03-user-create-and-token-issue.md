# 03 — Admin can create users and issue login tokens

**What to build:** `esl admin user create <username>` creates a Skill User, and `esl admin user token <username>` issues a one-time login token for that user.

**Blocked by:** 01 — Docker runtime bootstraps internal Gitea backend; 02 — Admin can check bootstrap readiness

**Status:** resolved

- [x] A platform administrator can create a new Skill User from ESL instead of entering Gitea directly.
- [x] A platform administrator can issue a one-time login token for an existing user, and the token is only revealed once.
- [x] Ordinary users do not need to manage a reusable password in the first version.

## Comments

Issued login tokens are created through Gitea and recorded as hashes in ESL so the same token can authenticate Git HTTP and remain subject to ESL user disable checks.
