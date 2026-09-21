# Gitea-Backed Administrator Account

Status: accepted

ESL will use the configured Gitea user as the ESL Administrator Account for the
near-term product model. Normal Skill User workflows should still speak in ESL
terms and use the single ESL Server URL, while administrator and operations
documentation may state that accounts, passwords, and tokens are currently
backed by Gitea. This keeps the user-facing product surface focused on ESL
without hiding the authority source from operators who need to diagnose or
recover the platform.

## Consequences

- Administrator account password changes target the configured
  `GITEA_ADMIN_USERNAME` account.
- The administrator account password command is
  `esl admin account change-password`, with help text that describes the
  configured ESL administrator account rather than Gitea.
- Only the configured ESL Administrator Account may change its own account
  password.
- The API route for this operation is `/api/admin/account/password`; the older
  Gitea-named route is not retained.
- The password-change route must authorize by validating the caller's token
  against the current Gitea user and requiring that username to match
  `GITEA_ADMIN_USERNAME`.
- The Bootstrap Token cannot change the ESL Administrator Account password,
  because it is a platform initialization credential rather than an account
  credential.
- The CLI accepts the new password only through a hidden prompt, stdin, or
  `--password-file`; it must not accept a plaintext password flag.
- Interactive password changes ask for the new password twice and require the
  entries to match. Stdin and `--password-file` are single-read automation
  paths.
- If the Bootstrap Token or another non-account credential calls the
  password-change route, the user-facing error should direct the operator to log
  in with the ESL Administrator Account.
- Successful password changes print
  `Administrator account password changed`.
- Tests should be rewritten around `esl admin account change-password` and
  `/api/admin/account/password`; the older Gitea-named CLI and API surfaces are
  deleted rather than retained as compatibility aliases.
- CLI command names should avoid exposing Gitea unless the operation is a
  Gitea-specific recovery or diagnostic path.
- Ordinary Skill User documentation should not require users to understand
  Gitea, but administrator documentation should describe the Gitea-backed
  account and token model, including the debug or recovery path for reaching
  the Gitea UI.
