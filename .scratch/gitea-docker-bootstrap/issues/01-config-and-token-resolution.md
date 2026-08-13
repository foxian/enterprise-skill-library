# 01 - Config and token-file resolution

Type: task
Status: ready-for-agent

**What to build:** Server configuration and startup support for resolving the
internal Gitea administrator token from either direct `GITEA_ADMIN_TOKEN` or
`GITEA_ADMIN_TOKEN_FILE`.

**Acceptance criteria:**

- [ ] Direct `GITEA_ADMIN_TOKEN` remains supported.
- [ ] Direct `GITEA_ADMIN_TOKEN` takes precedence over `GITEA_ADMIN_TOKEN_FILE`.
- [ ] Docker local runtime can omit direct `GITEA_ADMIN_TOKEN` when
  `GITEA_ADMIN_TOKEN_FILE` is configured.
- [ ] Token file contents are trimmed before use.
- [ ] Missing or empty token files fail startup with clear errors.
- [ ] Tests cover direct-token precedence, token-file-only config, unreadable
  token files, and empty token files.
