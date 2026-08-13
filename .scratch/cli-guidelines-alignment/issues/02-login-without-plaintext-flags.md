# 02 — Login without plaintext flags

**What to build:** `esl login` accepts credentials without ever typing them as
plaintext command-line flags. Interactively it prompts with input hidden;
non-interactively it reads from a file or stdin. The resolved token is stored in
the dedicated credentials file, while the general config keeps a copy so the
rest of the CLI still works until the migration ticket lands.

**Blocked by:** 01 — Credential store + prompt seam.

**Status:** ready-for-agent

- [ ] `esl login` no longer accepts `--password` or `--token` as plaintext
  flags.
- [ ] Interactive login prompts with input hidden.
- [ ] Non-interactive login accepts `--password-file`/`--token-file` or stdin.
- [ ] The resolved token is stored in the credentials file with owner-only
  permissions.
- [ ] The password-to-token exchange against the Git backend still works.

