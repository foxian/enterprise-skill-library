# Context

## Namespace

The stable namespace portion of a skill identity. In `@cnfox/code-review`, the
namespace is `cnfox`.

## Local Namespace

The reserved `local` namespace for skills that are local, unpublished, or not
yet assigned a stable publishing namespace.

## Local Skill Source

The original local directory where a skill is authored or maintained before it
is installed into a project skill store.

## Skill Identity

The full stable skill name in the form `@namespace/skill-name`.

## Adapted Skill Directory Name

The namespace-qualified directory name used for a skill in an AI tool's adapted
skill directory. It uses `namespace_skill-name`, such as `cnfox_code-review`, so
the namespace boundary remains unambiguous while staying within a single
tool-scanned directory level.

## Adapted Skill Display Name

The namespace-qualified name written into an adapted skill's `SKILL.md`
frontmatter for AI tools to display or identify the skill. It uses
`namespace:skill-name`, such as `cnfox:code-review`.

## Adapt Manifest

The source-store manifest that records which adapted skill outputs ESL last
generated for AI tools. Project skills use `.skills/.esl-adapt-manifest.json`;
global skills use `.skill-library/.esl-adapt-manifest.json`.

## Created By

The user who first created the skill. This is audit metadata, not the namespace
or current owner.

## Owner

The current business owner or platform owner of the skill.

## Maintainers

The users or teams allowed to maintain or publish the skill.

## ESL Platform Administrator

The person or automation identity allowed to manage ESL platform users,
permissions, and foundational skill library configuration.

## ESL Administrator Account

The configured administrator account that carries ESL platform administration
authority. For the current product model, this account is backed by the Gitea
user named by `GITEA_ADMIN_USERNAME`.
_Avoid_: Gitea account when referring to the ESL administration role.

## Gitea Service Administrator

The Gitea identity that backs the ESL Administrator Account and is used by ESL
to manage the internal Git backend on behalf of the platform. Its username is
configured by `GITEA_ADMIN_USERNAME`; its initial password is used during
first-run Bootstrap and may later be changed through the ESL Administrator
Account password-change command.
_Avoid_: Gitea administrator when referring to a human ESL Platform Administrator.

## Skill User

An authenticated person who can log in to ESL and consume, create, publish, or
maintain skills according to their permissions.

## Bootstrap

The first-run process that prepares the ESL Docker runtime with the platform
state required before normal users can operate it.

## Bootstrap Secret Volume

The Docker volume that stores the internal Gitea administrator token generated
by Bootstrap for API use.

_Avoid_: user token, Skill User token

## Bootstrap Token

The ESL platform administrator credential used for the first CLI login and
initial platform administration.

_Avoid_: Gitea admin token, Gitea Service Administrator token

## Skill User Token

The credential issued to a Skill User to authenticate ESL CLI operations such
as publishing, installing, updating, and using skills. It is distinct from the
Bootstrap Token, which is the platform administrator's first-run credential.

_Avoid_: user token, CLI token

## ESL Server

The single user-facing HTTP entry point for ESL CLI and automation clients. It
owns API access and discovery of Git clone URLs while hiding internal backend
service topology from normal Skill Users.

_Avoid_: registry when referring to the full user-facing service endpoint

## Registry API

The ESL Server API surface for skill metadata, search, publishing, install
resolution, authentication, and administration.

_Avoid_: server when referring only to API routes

## Git Backend

The internal repository hosting service used by ESL to store skill source
repositories. Skill Users should reach it through Git clone URLs discovered from
the ESL Server, not by configuring a separate backend base URL.

_Avoid_: Gitea when the specific implementation does not matter
