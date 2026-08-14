# Gitea Bootstrap Service Boundary

Status: accepted

The Docker runtime uses a one-shot `gitea-bootstrap` service to create or reuse
the configured Gitea Service Administrator and persist its internal API token
in a shared Bootstrap Secret Volume. The ESL API validates that token and
ensures the configured repository-owner organization before listening. This
keeps first-run Gitea state preparation separate from normal API startup while
allowing both operations to remain idempotent and independently testable.

The initial administrator password is explicitly supplied through
`GITEA_ADMIN_PASSWORD`, must be at least 12 characters, and is used only when
the administrator is first created. Existing administrator passwords are never
overwritten by later `.env` changes; password rotation uses
`esl admin account change-password` after logging in as the ESL Administrator
Account. If the token file is missing, bootstrap creates a replacement token
and preserves existing tokens. A successful one-shot bootstrap service exits
with code 0, and the API depends on that successful completion before
listening.
