Status: ready-for-agent

## Problem Statement

ESL currently makes Skill Users and automation configure two HTTP addresses:
one for the Registry API and one for the Git Backend. This exposes Gitea as a
normal client concern, forces the CLI to know Gitea-specific authentication
details, and contradicts the domain boundary that Gitea is an internal backend.

The current local workflow also makes the Docker runtime feel split: users call
the API at one URL and Git at another URL. ESL needs a single user-facing ESL
Server URL that owns API access, authentication, and Git clone URL discovery.

## Solution

ESL will expose one user-facing ESL Server URL to the CLI and automation. API
routes live under `/api`, Git HTTP routes live under `/git`, and Docker local
runtime defaults to a reverse-proxy entry point that exposes only the ESL
Server port.

The CLI will use `--server` and store a `server` setting. It will no longer
require or store `--registry`, `registry`, `--git-base`, or `gitBase`.

Login moves to the ESL Server at `POST /api/auth/login`. The CLI should not
call Gitea token APIs directly. The same Skill User Token authenticates both
API operations and Git HTTP operations. API responses that lead to Git
operations return clean, complete `cloneUrl` values. The CLI uses Git HTTP
authentication headers rather than embedding credentials in clone URLs.

## User Stories

1. As a Skill User, I want to configure one ESL Server URL, so that I do not
   have to understand the difference between the Registry API and the Git
   Backend.
2. As a Skill User, I want `esl login` to accept `--server`, so that the
   command names the service I am actually using.
3. As a Skill User, I want `esl login` to remember the ESL Server URL, so that
   later commands do not need the URL repeated.
4. As a Skill User, I want ESL to stop asking for `--git-base`, so that I do
   not have to configure an internal backend address.
5. As a Skill User, I want ESL to stop asking for `--registry`, so that the
   command vocabulary matches the single ESL Server entry point.
6. As a Skill User, I want password login to go through ESL, so that I do not
   authenticate directly against Gitea.
7. As a Skill User, I want my Skill User Token to work for both API and Git
   operations, so that one login is enough for normal CLI workflows.
8. As a Skill User, I want install commands to receive a complete clone URL
   from the ESL Server, so that the CLI does not derive Git Backend paths.
9. As a Skill User, I want publish commands to receive a complete clone URL
   from the ESL Server, so that pushing a skill works through the single ESL
   Server URL.
10. As a Skill User, I want update commands to use ESL Server-provided clone
    URLs, so that existing registry-backed skills continue to update without a
    separate backend base URL.
11. As a Skill User, I want source/use commands to use ESL Server-provided
    clone URLs, so that inspecting or using a skill source does not require a
    second HTTP address.
12. As a Skill User, I want clone URLs to be clean and credential-free, so that
    tokens do not appear in lockfiles, Git remotes, logs, or error output.
13. As a platform administrator, I want local Docker runtime to expose one
    default HTTP port, so that setup instructions are simpler and match the
    product boundary.
14. As a platform administrator, I want a debug override that can expose Gitea
    directly, so that backend recovery and development diagnostics remain
    possible.
15. As a platform administrator, I want `/git` to remain an internal or
    recovery path if it exposes Gitea UI, so that normal ESL documentation does
    not train users to manage Gitea directly.
16. As a maintainer, I want the CLI to stop knowing Gitea token API paths, so
    that Gitea remains replaceable behind the ESL Server boundary.
17. As a maintainer, I want API routes to keep the `/api` prefix, so that
    reverse-proxy routing stays explicit.
18. As a maintainer, I want Git HTTP routes to use the `/git` prefix, so that
    reverse-proxy routing stays explicit and separate from API routing.
19. As a maintainer, I want old `registry` and `gitBase` configuration removed
    rather than migrated, so that the codebase reflects the current development
    model without compatibility baggage.
20. As a CI operator, I want verification to run through the single ESL Server
    URL, so that automated checks prove the actual supported topology.
21. As a documentation reader, I want local development examples to show one
    server address, so that copy-pasted commands match the intended workflow.
22. As an API client author, I want responses that require Git operations to
    include `cloneUrl`, so that clients do not implement deployment-specific
    URL construction.
23. As a security reviewer, I want Git authentication to use headers instead
    of tokenized URLs, so that credentials are less likely to be persisted by
    Git tooling.

## Implementation Decisions

- The user-facing HTTP concept is the ESL Server.
- `server` replaces `registry` as the client configuration field.
- `--server` replaces `--registry` as the command-line option for commands
  that talk to ESL.
- `gitBase` and `--git-base` are removed rather than migrated because this
  project is still in development and does not need compatibility with local
  installs.
- API routes remain under `/api`.
- Git HTTP routes are exposed under `/git`.
- Login is owned by the ESL Server through `POST /api/auth/login`.
- The CLI must not call Gitea token APIs directly.
- The same Skill User Token authenticates API requests and Git HTTP requests.
- API responses that lead to Git operations include a complete, clean
  `cloneUrl`.
- The CLI must not construct Git Backend URLs from server URL plus repository
  path.
- The CLI must not embed credentials in clone URLs.
- The CLI supplies the Skill User Token to Git through Git HTTP authentication
  headers.
- The Docker local runtime uses a reverse proxy so the default user-facing
  runtime exposes one server port.
- The default Docker runtime should not expose Gitea directly to the host.
- A debug Docker override may expose Gitea directly for backend diagnostics and
  recovery.
- If `/git` exposes Gitea Web UI behavior, that surface remains an internal or
  recovery path rather than normal ESL documentation flow.
- Existing references in local development documentation should be updated from
  separate API and Gitea addresses to the single ESL Server URL.
- Existing ADRs that define Gitea as an internal backend remain in force.

## Testing Decisions

- Test behavior at the highest existing seams rather than internal helpers.
- CLI command tests should verify user-visible behavior for `--server`, saved
  server configuration, absence of required `--git-base`, and credential-free
  Git URLs.
- Login tests should verify that password login calls the ESL Server login API,
  stores the returned Skill User Token, and does not call Gitea token APIs.
- Network command tests should verify that install, publish, update,
  source/use, search, info, and admin commands read the saved `server` setting
  and call `/api` routes on that server.
- Git operation tests should verify that commands consume `cloneUrl` from API
  responses and pass the Skill User Token through Git HTTP headers.
- Server route tests should verify `POST /api/auth/login` external behavior
  using fake backend responses.
- Server API tests should verify that responses which trigger Git operations
  include a complete `cloneUrl`.
- Docker verification should smoke test the single exposed ESL Server URL after
  a fresh-volume startup.
- Documentation examples should be validated by command shape where practical:
  examples use `--server http://localhost:3000` and do not mention
  `--git-base`.
- Prior art exists in the repository's CLI command tests, server route tests,
  config tests, and Docker smoke setup.

## Out of Scope

- Production-grade secret manager integration.
- Short-lived Git token issuance.
- Separate API token and Git token flows.
- Keeping backward compatibility with saved `registry` or `gitBase`
  configuration.
- Keeping backward compatibility with `--registry` or `--git-base` flags.
- Replacing Gitea as the Git Backend.
- Building a public web portal for ESL.
- Removing Gitea UI behavior from `/git` entirely.
- A full Gitea administration UI replacement.
- Supporting multiple external Git Backend base URLs from one ESL Server.

## Further Notes

This spec follows ADR 0002, ADR 0003, and ADR 0004. Gitea remains the internal
Git Backend; normal Skill Users interact with the ESL Server. The implementation
should verify changes with `npm test` and `npm run build`.
