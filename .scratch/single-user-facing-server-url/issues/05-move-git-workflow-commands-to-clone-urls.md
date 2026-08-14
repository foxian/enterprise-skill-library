# 05 — Move Git Workflow Commands To Clone URLs

**What to build:** Publish, install, update, source, and use workflows consume ESL Server-provided `cloneUrl` values and authenticate Git HTTP operations with the Skill User Token through headers rather than credentialed URLs.

**Blocked by:** 02 — Teach CLI Login To Use ESL Server; 04 — Return Clean Clone URLs From ESL Server APIs.

**Status:** resolved

- [ ] Publish uses the API-provided `cloneUrl` when pushing skill source.
- [ ] Install uses the API-provided `cloneUrl` when cloning a skill.
- [ ] Update uses API-provided or refreshed `cloneUrl` values for registry-backed skills.
- [ ] Source and use workflows use API-provided `cloneUrl` values when cloning skill source.
- [ ] Git operations receive the Skill User Token through Git HTTP authentication headers.
- [ ] Tokens are not embedded in clone URLs, lockfiles, Git remotes, or normal command output.
- [ ] CLI tests cover Git command arguments and persisted metadata for credential-free URLs.
