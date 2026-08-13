## Problem Statement

The Docker runtime still exposes Gitea first-run setup as a manual setup
concern. An ESL Platform Administrator must create the Gitea Service
Administrator, create or copy a Gitea administrator token, configure the API
with that token, and create the repository-owner organization before normal
Skill Users can use the skill library. This contradicts the product boundary:
Gitea is an internal backend, not the normal administration surface.

ESL needs Bootstrap to prepare the Gitea backend automatically while keeping
credentials explicit, recoverable, and safe to re-run.

## Solution

Docker Bootstrap will use a one-shot `gitea-bootstrap` service to create or
reuse the configured Gitea Service Administrator and generate an internal Gitea
administrator token for API use. The Gitea Service Administrator username comes
from `GITEA_ADMIN_USERNAME`; the initial password comes from
`GITEA_ADMIN_PASSWORD` and is used only when the administrator is first created.

The generated token is written to the Bootstrap Secret Volume and read by the
API through `GITEA_ADMIN_TOKEN_FILE`. The API still supports direct
`GITEA_ADMIN_TOKEN` as an override for tests and non-Docker deployments, but
Docker local runtime must not require users to create or paste that token.

The API validates the resolved Gitea administrator token and ensures the
configured repository-owner organization before listening. If token resolution,
token validation, or organization ensure fails, the API does not start.

The end-user Docker setup should be:

1. Copy `.env.example` to `.env`.
2. Set `GITEA_ADMIN_PASSWORD` to an explicit password of at least 12
   characters.
3. Run `docker compose up --build`.
4. Use ESL admin commands without opening the Gitea UI for normal setup.

## User Stories

1. As an ESL Platform Administrator, I want Docker Bootstrap to create the
   Gitea Service Administrator, so that I do not have to complete Gitea setup
   manually.
2. As an ESL Platform Administrator, I want to set the initial Gitea Service
   Administrator password explicitly, so that I control the recovery credential
   from first boot.
3. As an ESL Platform Administrator, I want `GITEA_ADMIN_PASSWORD` to be used
   only during first-run Bootstrap, so that changing `.env` later does not
   unexpectedly mutate an existing backend account.
4. As an ESL Platform Administrator, I want password rotation to happen through
   `esl admin gitea password`, so that recovery-password changes are explicit.
5. As an ESL Platform Administrator, I want Bootstrap to reject an empty,
   example, or too-short `GITEA_ADMIN_PASSWORD`, so that insecure local
   runtime credentials are not silently accepted.
6. As an ESL Platform Administrator, I want Bootstrap to generate the internal
   Gitea administrator token automatically, so that I do not copy tokens
   between Gitea and ESL.
7. As an ESL Platform Administrator, I want the internal Gitea administrator
   token stored in the Bootstrap Secret Volume, so that the API can use it
   without exposing it in `.env`.
8. As an ESL Platform Administrator, I want the token file to be reused on
   later starts, so that restarting Docker does not create a new token every
   time.
9. As an ESL Platform Administrator, I want Bootstrap to create a replacement
   token if the token file is missing, so that the runtime can recover without
   deleting all volumes.
10. As an ESL Platform Administrator, I want Bootstrap to preserve older tokens
    when creating a replacement token, so that recovery does not break any
    still-running API instance.
11. As an ESL Platform Administrator, I want Bootstrap to be idempotent, so
    that repeated `docker compose up` runs do not recreate users, overwrite
    passwords, or fail on already-created state.
12. As an ESL Platform Administrator, I want the API to read the internal token
    from `GITEA_ADMIN_TOKEN_FILE`, so that Docker local runtime no longer
    requires `GITEA_ADMIN_TOKEN`.
13. As a maintainer, I want direct `GITEA_ADMIN_TOKEN` to remain supported, so
    that tests and non-Docker deployments can stay simple.
14. As a maintainer, I want direct `GITEA_ADMIN_TOKEN` to take precedence over
    `GITEA_ADMIN_TOKEN_FILE`, so that explicit test and deployment overrides
    behave predictably.
15. As an ESL Platform Administrator, I want the API to validate the Gitea
    administrator token before listening, so that Docker does not report the
    API as started when the backend credential is unusable.
16. As an ESL Platform Administrator, I want the API to create the configured
    repository-owner organization when missing, so that fresh Docker volumes
    are ready for publishing skills.
17. As an ESL Platform Administrator, I want the API to fail startup if the
    repository-owner organization cannot be ensured, so that failures appear at
    startup instead of later user commands.
18. As a CI operator, I want `esl admin bootstrap status` to report real
    readiness, so that automation can distinguish Gitea, token, and repository
    owner failures.
19. As a CI operator, I want the final verification to run against fresh Docker
    volumes, so that the system proves first-run Bootstrap rather than only
    warmed state.
20. As a Skill User, I want normal ESL setup to avoid the Gitea UI, so that I
    can use the skill library without learning the internal Git backend.

## Implementation Decisions

- Use a one-shot `gitea-bootstrap` Docker service for first-run Gitea state.
- Use the official Gitea image for the bootstrap service so it can use Gitea's
  own administrative CLI.
- Mount the same Gitea data volume into `gitea` and `gitea-bootstrap`.
- Create a Bootstrap Secret Volume shared by `gitea-bootstrap` and the API.
- Require `GITEA_ADMIN_USERNAME`, defaulting to `admin`.
- Require `GITEA_ADMIN_PASSWORD` for Docker Bootstrap.
- Reject `GITEA_ADMIN_PASSWORD` when it is empty, still the example value, or
  shorter than 12 characters.
- Treat `GITEA_ADMIN_PASSWORD` as a first-run input only.
- Do not overwrite the Gitea Service Administrator password on later starts.
- Keep recovery-password rotation in `esl admin gitea password`.
- Generate the internal Gitea administrator token in Bootstrap.
- Store the generated token in the Bootstrap Secret Volume.
- Do not print the generated token in normal logs.
- Reuse a non-empty token file on later starts.
- Generate a replacement token when the token file is missing.
- Do not revoke older tokens during replacement-token recovery in the first
  version.
- Run Gitea readiness checks before invoking Gitea administrative CLI commands.
- Make the API depend on successful `gitea-bootstrap` completion before
  listening.
- Let direct `GITEA_ADMIN_TOKEN` override `GITEA_ADMIN_TOKEN_FILE`.
- Let `GITEA_ADMIN_TOKEN_FILE` support Docker local runtime without a direct
  token environment variable.
- Validate the resolved Gitea administrator token before API listen.
- Ensure the configured repository-owner organization before API listen.
- Fail API startup when token resolution, token validation, or organization
  ensure fails.
- Extend Bootstrap readiness reporting so it distinguishes Gitea, admin token,
  and repository-owner readiness.
- Keep Gitea as an internal backend; ordinary Skill User onboarding remains
  through ESL admin commands.

## Testing Decisions

- Prefer the highest existing seam for server runtime behavior: `startServer`
  tests with injected dependencies.
- Test config loading through `loadServerConfig`, including direct token
  precedence and token-file-only Docker configuration.
- Test Gitea service behavior through its public methods and fake fetch
  responses, not by inspecting private fields.
- Test API startup ensure behavior before `listen`, including invalid token and
  organization ensure failure.
- Test admin bootstrap status through the HTTP route seam.
- Treat Docker Compose itself as requiring a real fresh-volume smoke test
  before declaring the feature complete.
- Keep the final smoke path concrete: `docker compose down -v`, set
  `GITEA_ADMIN_PASSWORD`, `docker compose up --build`,
  `esl admin bootstrap status`, `esl admin user create alice`, and
  `esl admin user token alice`.
- Keep tests focused on externally visible behavior: startup succeeds or
  fails, HTTP status responses, CLI output, and Gitea API calls.

## Out of Scope

- Production secret-manager integration.
- Public self-registration.
- ESL username/password login.
- Web UI setup wizard.
- Multiple Gitea Service Administrator accounts.
- Automatic password rotation from `.env` after first boot.
- Automatic revocation of older Gitea administrator tokens.
- A full Gitea administration UI replacement.

## Further Notes

This spec follows ADR 0003. Bootstrap prepares first-run Gitea state; the API
validates runtime readiness and ensures the repository-owner organization
before listening. A successful `gitea-bootstrap` service exiting with code 0 is
normal, not a failure.
