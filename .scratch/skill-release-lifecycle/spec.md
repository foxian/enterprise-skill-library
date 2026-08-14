Status: ready-for-agent

## Problem Statement

ESL has the core pieces for publishing, installing, updating, and sourcing
skills, but the product path is not yet proven as one coherent Skill Release
lifecycle. A Skill Author needs to publish a Skill Release through the ESL
Server, and another Skill User needs to discover, install, update, and source
that release without learning the Git Backend topology or using Gitea as a
normal product surface.

The current risk is that individual commands pass their focused tests while the
real cross-user journey still fails in Docker, especially around login state,
clean clone URLs, Git HTTP authentication headers, update resolution, and
documentation. Without a fresh-volume walkthrough, a new operator cannot prove
that the platform is usable from first bootstrap through shared skill
consumption.

## Solution

Prove the server-backed project Skill Release lifecycle before introducing a
dedicated release schema. The next implementation pass should make the
following path reliable and documented:

1. Start ESL from a fresh Docker volume.
2. Bootstrap the platform and log in with the ESL Administrator Account.
3. Create two ordinary Skill Users: `author` and `consumer`.
4. Have `author` initialize and publish a Skill Release through the ESL Server.
5. Have `consumer` discover the Skill Release with search/info.
6. Have `consumer` install the Skill Release into a project.
7. Have `author` create a patch Skill Release with `esl version patch` and
   publish it.
8. Have `consumer` update the project install to the new Skill Release.
9. Have `consumer` clone the Skill Source Repository with `esl source` into
   `.scratch/smoke-workspace/source-copy`.

The work should use the existing service model and current metadata shape. The
term Skill Release describes the user-facing artifact, but this spec does not
require a new release table, release schema, or broad data-model migration.

## User Stories

1. As a Skill Author, I want to publish a Skill Release through the ESL Server,
   so that other Skill Users can discover and install my skill.
2. As a Skill Author, I want `esl publish` to create or update the backing Skill
   Source Repository through ESL, so that I do not manage Git Backend details
   directly.
3. As a Skill Author, I want publish to use a clean clone URL returned by the
   ESL Server, so that my Skill User Token is not written into remotes or
   command output.
4. As a Skill Author, I want publish to fail clearly when I am not logged in,
   so that I know to run `esl login`.
5. As a Skill Author, I want publish to fail clearly when my login is expired,
   so that I know to re-authenticate before publishing.
6. As a Skill Author, I want publish to fail clearly when no ESL Server is
   configured, so that I know to configure or pass `--server`.
7. As a Skill Author, I want to create a patch Skill Release with
   `esl version patch` and publish it, so that consumers can update from one
   release to the next.
8. As a Skill User, I want to search for a published Skill Release through the
   ESL Server, so that I can find shared skills without knowing the Git Backend.
9. As a Skill User, I want to view Skill Release information through the ESL
   Server, so that I can decide whether to install it.
10. As a Skill User, I want install resolution to return a clean clone URL, so
    that install can clone through the ESL Server without embedding
    credentials.
11. As a Skill User, I want to install a server-backed Skill Release into my
    project, so that the project records the dependency and installed files.
12. As a Skill User, I want project install state to record the installed Skill
    Release version, so that future updates know what is currently installed.
13. As a Skill User, I want `esl update` to find a newer server-backed Skill
    Release, so that my project can move from the installed release to the
    latest release.
14. As a Skill User, I want `esl update` to leave already-current installs
    unchanged, so that running update repeatedly is safe.
15. As a Skill User, I want update to clone through clean ESL Server clone URLs
    with Git HTTP authentication headers, so that credentials are not persisted
    in project files.
16. As a Skill User, I want update to fail clearly when I am not logged in and
    a server-backed dependency is present, so that I know to log in before
    updating.
17. As a Skill User, I want update to fail clearly when my login is expired and
    a server-backed dependency is present, so that I know to re-authenticate.
18. As a Skill User, I want update to fail clearly when no ESL Server is
    configured for a server-backed dependency, so that I know what configuration
    is missing.
19. As a Skill User, I want to clone the Skill Source Repository with
    `esl source`, so that I can inspect or modify a shared skill locally.
20. As a Skill User, I want `esl source` to work for a skill authored by another
    user, so that source access proves cross-user sharing rather than only
    author self-access.
21. As a Skill User, I want `esl source` to clone into an explicit target
    directory during smoke verification, so that the walkthrough is repeatable
    and does not pollute the repository root.
22. As an ESL Platform Administrator, I want to create separate `author` and
    `consumer` Skill Users, so that the smoke path proves ordinary user
    sharing instead of relying on administrator privileges.
23. As an ESL Platform Administrator, I want the fresh-volume walkthrough to
    begin from a clean Docker state, so that it proves first-run onboarding as
    well as the lifecycle commands.
24. As an operator, I want the walkthrough to keep Gitea as a recovery and
    diagnostics path only, so that normal users keep working through the ESL
    Server.
25. As a maintainer, I want the automated tests to cover common CLI failure
    paths, so that regressions in login/configuration messaging are caught
    before the Docker smoke path is run.
26. As a maintainer, I want the lifecycle work to avoid a release-schema
    migration, so that the product path is proven before broad data-model work
    begins.
27. As a maintainer, I want global installs and Local Skill Source updates kept
    separate from this lifecycle, so that this pass stays focused on the
    server-backed project path.

## Implementation Decisions

- Use the existing service model to prove the Skill Release lifecycle. Do not
  introduce a dedicated Skill Release schema or release table in this pass.
- Treat Skill Release as the user-facing term for a published installable
  version of a Skill Identity.
- Focus the implementation on server-backed project installs. Project state
  should record dependency and lock data for the installed Skill Release.
- Use two ordinary Skill Users in the walkthrough: `author` publishes releases,
  and `consumer` discovers, installs, updates, and sources them.
- Keep ESL Server as the only normal user-facing service address. CLI commands
  should use `--server` or saved server configuration, and normal workflows
  should not require a separate Git Backend URL.
- Publish and Git-consuming commands must use clean clone URLs returned by ESL
  Server APIs. Skill User Tokens must be supplied through Git HTTP
  authentication headers, not embedded in clone URLs, Git remotes, lockfiles, or
  normal command output.
- The second Skill Release in the walkthrough is created by running
  `esl version patch` followed by `esl publish`, not by directly editing server
  state.
- `esl update` scope is server-backed project install only. Global install,
  global update, Local Skill Source install, and Local Skill Source update are
  out of scope for this lifecycle pass.
- `esl source` is included in scope and should be executed by `consumer`, not
  only by `author`, to prove cross-user source access through the ESL Server.
- The walkthrough target for source cloning is
  `.scratch/smoke-workspace/source-copy`.
- Common failure paths for missing login, expired login, and missing ESL Server
  configuration should be automated at the CLI command seam.
- Add a dedicated walkthrough document at
  `docs/guides/skill-release-lifecycle.md`. The walkthrough should be
  repeatable from a fresh Docker volume and should not replace the shorter
  usage or local-development guides.
- Administrator and operations documentation may mention that ESL accounts and
  tokens are currently backed by Gitea. Ordinary Skill User workflow steps
  should remain expressed in ESL Server terms.
- Respect ADR 0004, ADR 0005, and ADR 0006.

## Testing Decisions

- Tests should verify external behavior through public seams rather than
  internal helper details.
- Use the existing CLI command-execution seams for focused tests:
  publish/install/update/source helpers with injected fetch, Git execution,
  home directory, and project root.
- Use CLI tests to cover missing login, expired login, and missing ESL Server
  configuration for server-backed lifecycle commands.
- Use existing Git-command assertions to verify that clone URLs stay clean and
  Skill User Tokens are passed through Git HTTP authentication headers.
- Use server API tests through the Fastify app seam to verify the API behavior
  that makes Skill Releases discoverable and installable by another Skill User.
- Use existing publish, install, update, and source tests as prior art for the
  CLI seam.
- Use existing admin and app tests as prior art for cross-user authentication
  through the Gitea-backed account model.
- Do not add low-level private-helper tests unless a public seam cannot express
  the behavior.
- Add or update the dedicated walkthrough as the manual fresh-volume smoke
  seam. The walkthrough must include the exact command sequence for bootstrap,
  `author`/`consumer` creation, publish, search, info, install, patch publish,
  update, and source.
- Final verification for implementation work should include focused tests,
  `npm test`, and `npm run build`.

## Out of Scope

- A dedicated Skill Release database schema or release table.
- Global install and global update behavior.
- Local Skill Source install/update behavior.
- Automatic adapt integration as part of the lifecycle smoke.
- Replacing Gitea as the Git Backend.
- A full Gitea administration UI replacement.
- Enterprise governance features such as approvals, audit logs, teams, or
  visibility policy changes.
- Full recovery-path testing for Git clone authentication failure, repository
  creation failure, or low-level Gitea outages.
- Compatibility behavior for old `registry` or `gitBase` configuration
  surfaces.

## Further Notes

This spec follows the single ESL Server URL decision, the Gitea-backed
administrator account decision, and the Skill Release lifecycle-before-schema
decision. The primary goal is to prove that ESL behaves like a usable shared
skill platform for ordinary Skill Users before expanding the domain model or
enterprise governance surface.
