# Context

## Namespace

服务器托管技能身份中的稳定平台组织名。在
`@platform-ai/code-review` 中，Namespace 是 `platform-ai`。

## Skill Source Lifecycle

## Skill ID

服务器为服务器托管技能生成的不可变标识。Owner、公开名称或 Git 仓库地址变化
时，仍以它作为查找键。它在首次 Source Upload 时生成，即使技能尚未产生
Skill Release 也一直存在。其格式为带 `sk_` 前缀的 ULID。

## Skill Rename

平台管理员或 Owner 对 Server-hosted Skill Identity 执行的显式改名操作。
Skill ID 保持不变，旧 Identity 永久重定向到新 Identity。普通 Git push
不得直接改变 `SKILL.md.name` 或技能身份；名称变更必须经过该流程。使用旧
Identity 安装时，客户端提示迁移到新 Identity；指定历史 Release 时仍允许
安装旧包。旧 Identity 永久保留且不得被其他技能复用。

## Skill Update Migration

已安装技能因 Skill Rename 而产生新 Identity 时，`update` 基于同一个 Skill ID
自动迁移本地安装目录、依赖键、锁文件和适配输出的操作。固定旧 Release 的
安装不受影响。

## Server-hosted Skill Source

技能上传至 ESL Server 的 Platform Organization 后形成的协作维护源码仓库。
它独立于 Skill Release 存在；上传时其 `skill.json` 中的 Skill Identity
会被规范化为 Platform Organization 的 Namespace。

## Source Upload

从本地技能首次创建 Server-hosted Skill Source 的操作。它创建 Skill ID 和
服务器 Git 仓库，不用于覆盖已存在的服务器源码。

## Source Update

Maintainer 将对 Server-hosted Skill Source 的后续 Git 提交推送到服务器的
操作。它不创建 Skill Release。

## Source Checkout

通过 `source` 获取 Server-hosted Skill Source 的操作，默认检出当前 `main`
分支；需要复现历史内容时必须显式指定 Git ref 或 Skill Release。

## Source Remote

本地技能仓库指向 ESL Server 源码仓库的独立 Git remote，名称为 `esl`；首次
Source Upload 不覆盖用户已有的 `origin`。

## Active Unreleased Skill Source

已上传但尚未产生 Skill Release、仍可由 Maintainer 协作维护的
Server-hosted Skill Source。它可以被授权用户下载源码，但不能作为技能安装。
首次上传由已登录 Skill User 发起，上传者自动成为初始 Maintainer。

## Archived Skill

被明确停用或废弃的 Server-hosted Skill。它不再接受源码修改或新的
Skill Release；其 Skill ID、Git 历史、历史 Skill Release、Published Skill
Package、安装记录和名称重定向仍然保留。初期不允许物理删除；未来如需清理，
必须通过带审计、备份和恢复窗口的受控治理流程。恢复 Archived Skill 仅允许
ESL Platform Administrator 执行。

## Unreleased Skill Source

尚未产生任何 Skill Release 的 Server-hosted Skill Source。经授权的 Skill User
可以下载和修改其源码，但不能将它作为技能安装。

## Published Skill Package

发布 Skill Release 时生成的、不可变且带 Namespace 的安装产物。远程安装消费
该产物，而非源码仓库；它绑定产生该 Release 的源码 commit，发布后不可覆盖或
删除。

## Platform Organization

ESL 初始化时配置的唯一组织。它是全部 Skill User 的共享源码仓库空间，并为
每个 Server-hosted Skill Identity 提供 Namespace；正常运行期间不得变更。

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
installed, updated to, or used by a Skill User. It is created from a specific
source commit of a Server-hosted Skill Source. Published Skill Source may
continue to change, but only a new Skill Release can affect installation or
update.
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

允许修改 Server-hosted Skill Source 并发布 Skill Release 的用户或团队。

## ESL Platform Administrator

The person or automation identity allowed to manage ESL platform users,
permissions, and foundational skill library configuration.
它对失联、停用或无人维护的技能拥有治理兜底权。

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
