# Bootstrap Gitea as an Internal ESL Backend

- Status: Accepted
- Date: 2026-08-12

## Context

ESL uses Gitea as its Git backend for authentication, repository hosting, and
skill ownership. Requiring users to complete Gitea's first-run setup, create
service accounts, and manage foundational org state would expose an internal
backend concern as part of the normal ESL workflow.

## Decision

Bootstrap Gitea as part of the Docker runtime and treat it as an internal ESL
backend. ESL users should manage platform users and foundational skill-library
state through ESL CLI/API entry points, not through Gitea's UI as the normal
path.

## Consequences

- Docker startup must prepare the platform state needed for ESL to operate.
- ESL can present a narrower operational surface focused on skill-library tasks.
- Gitea UI remains available as an internal or recovery path, but not the
  primary management interface.
