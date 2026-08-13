# 02 - API startup validates Gitea runtime

Type: task
Status: ready-for-agent

**What to build:** API startup validates the resolved Gitea administrator token
and ensures the configured repository-owner organization before listening.

**Blocked by:** 01

**Acceptance criteria:**

- [ ] API validates the resolved Gitea administrator token before listening.
- [ ] API does not listen when token validation fails.
- [ ] API ensures `GITEA_REPO_OWNER` before listening.
- [ ] API does not listen when repository-owner ensure fails.
- [ ] Tests prove the trimmed token-file value reaches Gitea authorization.
- [ ] Tests prove validation and organization ensure happen before listen.
