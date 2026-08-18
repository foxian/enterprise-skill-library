# Context

## Namespace

The stable namespace portion of a skill identity. In `@cnfox/code-review`, the
namespace is `cnfox`.

## Local Namespace

The reserved `local` namespace for Skill Identities installed from a Local
Skill Source. `@local/*` distinguishes local path sourced skills from skills
installed from the ESL Server.

## Local Skill Source

The original local directory where a skill is authored or maintained before it
is installed into a project skill store.

## Skill Identity

The full stable skill name in the form `@namespace/skill-name`.

## Skill Release

A specific published version of a Skill Identity that can be discovered,
installed, updated to, or used by a Skill User.
_Avoid_: version when referring to the installable skill artifact.

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

## Skill User Credential

A username and password pair that a Skill User presents to log in to ESL. The
password is hosted and validated by Gitea; ESL never stores the password
itself.

## Skill User Initial Password

The password a Skill User uses to log in for the first time. It is generated
randomly when the user is created and shown to the platform administrator
exactly once for hand-off, or it may be supplied by the administrator. It may be
changed by the Skill User afterwards.
_Avoid_: default password, temporary password

## Skill User Password Change

The Skill User's self-service action to replace their own password. It requires
the current password and takes effect in Gitea.
_Avoid_: password reset

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

## Git Backend Maintenance Entry

The internal or recovery web entry point for inspecting and maintaining the Git
Backend. It is not the normal product surface for Skill Users.

_Avoid_: Gitea backend address, Gitea user portal
