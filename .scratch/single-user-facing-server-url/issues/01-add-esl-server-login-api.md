# 01 — Add ESL Server Login API

**What to build:** `POST /api/auth/login` exchanges a Skill User username and password for a Skill User Token through the ESL Server, so CLI clients do not need to call Gitea token APIs directly.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [ ] A client can submit valid username/password credentials to the ESL Server login API and receive a Skill User Token in a stable machine-readable response.
- [ ] Invalid credentials return a failed HTTP response without issuing a token.
- [ ] The login API keeps Gitea-specific token creation behind the ESL Server boundary.
- [ ] Existing authentication behavior for token-protected API routes continues to work.
- [ ] Focused server tests cover successful login, failed login, and backend error behavior.
