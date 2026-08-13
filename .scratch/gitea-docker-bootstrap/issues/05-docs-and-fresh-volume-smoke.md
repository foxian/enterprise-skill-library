# 05 - Docs and fresh-volume smoke verification

Type: task
Status: ready-for-agent

**What to build:** Update setup docs and verify Docker Bootstrap through a
fresh-volume smoke test.

**Blocked by:** 03, 04

**Acceptance criteria:**

- [ ] `.env.example` documents `GITEA_ADMIN_USERNAME`,
  `GITEA_ADMIN_PASSWORD`, and `GITEA_ADMIN_TOKEN_FILE`.
- [ ] Local setup docs no longer instruct users to open Gitea for normal
  first-run setup.
- [ ] Docker setup docs no longer instruct users to manually create and paste
  `GITEA_ADMIN_TOKEN`.
- [ ] Docs explain that `GITEA_ADMIN_PASSWORD` is a first-run input only.
- [ ] Docs explain that password rotation uses `esl admin gitea password`.
- [ ] Fresh-volume Docker smoke test is run before declaring completion.
- [ ] Smoke test covers `bootstrap status`, Skill User creation, and Skill User
  token issuance.
