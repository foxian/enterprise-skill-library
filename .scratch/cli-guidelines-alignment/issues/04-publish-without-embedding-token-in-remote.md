# 04 — Publish without embedding token in the remote

**What to build:** `esl publish` pushes to the Git backend without writing the
token into the Git remote configuration. The token is passed for the push
operation via an authorization header, so it never ends up persisted in
`.git/config` or any other on-disk Git state.

**Blocked by:** 03 — Migrate commands to the credential store.

**Status:** ready-for-agent

- [ ] `esl publish` pushes without writing the token into the Git remote
  configuration.
- [ ] The Git command used for the push carries the token via an authorization
  header rather than in the remote URL.
- [ ] Publishing still succeeds end-to-end.

