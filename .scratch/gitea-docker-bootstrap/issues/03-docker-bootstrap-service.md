# 03 - Docker bootstrap service

Type: task
Status: ready-for-agent

**What to build:** Add the one-shot `gitea-bootstrap` Docker service and shared
Bootstrap Secret Volume.

**Blocked by:** 01, 02

**Acceptance criteria:**

- [ ] `docker-compose.yml` includes a one-shot `gitea-bootstrap` service.
- [ ] `gitea-bootstrap` uses the official Gitea image.
- [ ] `gitea-bootstrap` shares the Gitea data volume with the Gitea service.
- [ ] `gitea-bootstrap` writes the internal token to the Bootstrap Secret
  Volume.
- [ ] API reads the token from the Bootstrap Secret Volume.
- [ ] API depends on successful `gitea-bootstrap` completion.
- [ ] `GITEA_ADMIN_USERNAME` defaults to `admin`.
- [ ] `GITEA_ADMIN_PASSWORD` is required for Docker Bootstrap.
- [ ] Bootstrap rejects empty, example, or too-short initial passwords.
- [ ] Bootstrap is idempotent when the administrator and token file already
  exist.
- [ ] Bootstrap generates a replacement token if the token file is missing.
- [ ] Bootstrap does not overwrite an existing administrator password.
