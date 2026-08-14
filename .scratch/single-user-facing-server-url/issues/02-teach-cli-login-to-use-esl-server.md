# 02 — Teach CLI Login To Use ESL Server

**What to build:** `esl login --server <url>` authenticates through the ESL Server login API, saves the ESL Server URL and Skill User Token, and no longer asks users for a separate Registry API or Git Backend URL.

**Blocked by:** 01 — Add ESL Server Login API.

**Status:** resolved

- [ ] `esl login` accepts `--server <url>` as the required user-facing service address.
- [ ] Password login calls the ESL Server login API and stores the returned Skill User Token.
- [ ] Token-file login stores the provided Skill User Token with the ESL Server URL.
- [ ] Saved client configuration uses `server` as the user-facing URL field.
- [ ] The login command does not require or use `--git-base`.
- [ ] CLI tests cover interactive/password-file/token-file login paths through the ESL Server model.
