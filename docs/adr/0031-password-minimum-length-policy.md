# Password Minimum Length Policy

Status: accepted

## Context

ESL does not store passwords; every password (platform admin, org admin,
member) is applied to the user's Gitea account, and Gitea performs the final
verification. Gitea's upstream default `MIN_PASSWORD_LENGTH` is 8, but the
bootstrap-era deployment decision required the platform super-admin password
(`GITEA_ADMIN_PASSWORD`) to be at least 12 characters. Later, the unified
account policy (ADR-0017 era) promoted that value into
`DEFAULT_PASSWORD_MIN_LENGTH = 12` in `@esl/core` and threaded
`ESL_PASSWORD_MIN_LENGTH` through registration, member creation, and password
changes — but the choice of 12 itself was never recorded, and the bootstrap
check stayed a separate hardcoded 12, producing two rulers for one policy.

## Decision

- The shared password minimum length is **8** (the default of
  `DEFAULT_PASSWORD_MIN_LENGTH` in `@esl/core`), configurable via
  `ESL_PASSWORD_MIN_LENGTH`.
- There is **no maximum length**; validation only rejects below-minimum
  passwords.
- **One ruler**: `ESL_PASSWORD_MIN_LENGTH` is injected by docker-compose into
  three consumers — the ESL API server, Gitea
  (`GITEA__security__MIN_PASSWORD_LENGTH`), and the
  `gitea-bootstrap.sh` admin-password check — so both systems and the
  bootstrap gate always agree.

## Rationale

- ESL is an internal, self-hosted deployment tool; login frequency is low, so
  a longer-than-necessary minimum only adds friction for internal users.
- 8 is Gitea's own upstream baseline; matching it keeps the policy unsurprising
  and consistent with the Git Backend. Deployments wanting stricter policy set
  `ESL_PASSWORD_MIN_LENGTH` without code changes.
- Randomly generated initial passwords are 24 characters
  (`crypto.randomBytes(18).toString('base64url')`) and unaffected by the
  minimum.

## Consequences

- Existing passwords are unaffected; the minimum applies only when a password
  is set or changed.
- The value in an already-initialized Gitea data volume's `app.ini` is
  rewritten from the compose environment on startup; after changing
  `ESL_PASSWORD_MIN_LENGTH`, restart the stack and verify the effective value
  rather than assuming it.
- Historical test reports and `.scratch` specs referencing the old default of
  12 are records of their time and are intentionally left unchanged.
