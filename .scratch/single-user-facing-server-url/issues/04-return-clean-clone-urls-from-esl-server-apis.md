# 04 — Return Clean Clone URLs From ESL Server APIs

**What to build:** ESL Server API responses that lead to Git operations include complete, credential-free `cloneUrl` values, so clients can perform Git work without deriving Git Backend paths.

**Blocked by:** 01 — Add ESL Server Login API.

**Status:** resolved

- [ ] Skill publish/create responses that require a push include a complete `cloneUrl`.
- [ ] Skill install or resolution responses that require a clone include a complete `cloneUrl`.
- [ ] Skill source lookup responses that require a clone include a complete `cloneUrl`.
- [ ] Returned clone URLs are clean and do not embed Skill User Tokens or other credentials.
- [ ] Clone URLs point at the ESL Server Git HTTP route rather than a separately configured Git Backend base URL.
- [ ] Server tests cover clone URL shape for each Git-producing API response.
