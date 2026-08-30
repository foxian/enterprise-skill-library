# Context

## Scope

Skill Identity 形式 `@scope/skill-name` 的第一段。它是机械层概念，无治理
含义；adapt 引擎按它生成安装目录名与展示名。Scope 分两类：由 Platform
Organization 占用的 Namespace，以及保留 Scope（`local`、`builtin`）。

## Namespace

由 Platform Organization 占用的 Scope。它带治理语义：运行后不可变，在
Bootstrap 时配置，为所有 Server-hosted Skill Identity 提供稳定平台组织名。
在 `@platform-ai/code-review` 中，Namespace 是 `platform-ai`。保留 Scope
不是 Namespace。

## Skill Source Lifecycle

## Skill ID

服务器为服务器托管技能生成的不可变标识。Owner、公开名称或 Git 仓库地址变化
时，仍以它作为查找键。它在首次 Source Upload 时生成，即使技能尚未产生
Skill Release 也一直存在。其格式为带 `sk_` 前缀的 ULID。

## Skill Rename

平台管理员或 Owner 对 Server-hosted Skill Identity 执行的显式改名操作。
Rename 只改短名，不改 scope 段；scope 段由 Platform Organization 锁定。
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
它独立于 Skill Release 存在；其 Skill Identity 由服务器记录，源码中的
`SKILL.md.name` 保持短名并与服务器记录的当前短名一致。源码以
`SKILL.md` 与 Release Manifest（`release.json`）为内容；它不包含 Skill
Manifest（`skill.json`），后者只作为安装副本或 Published Skill Package 的
生成物存在。

## Source Upload

把本地技能源码提交并推送到服务器成为 Server-hosted Skill Source 的
esl 化操作：首次创建 Skill ID 与服务器 Git 仓库，之后对已托管源（已有
esl remote）直接同步、跳过登记。它自动完成 git 前置（init、.gitignore、
提交，说明可用 --message 指定），已托管源推前自动 rebase 到服务器最新并
处理冲突，`HEAD` 与服务器源一致时报告已是最新。改名不通过修改
SKILL.md 完成（见 Skill Rename）。

## Source Update

Maintainer 将对 Server-hosted Skill Source 的后续 Git 提交推送到服务器的
操作。它不创建 Skill Release。可通过 `esl upload`（esl 化，含自动提交与
rebase）或裸 `git push esl main` 完成。

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
Package、安装记录和名称重定向仍然保留。恢复 Archived Skill 仅允许
ESL Platform Administrator 执行。

## Deleted Skill

被 ESL Platform Administrator 完全删除的 Server-hosted Skill，用于彻底清理
（与 Archived Skill 的保留式停用相对）。删除是物理的、不可恢复的：移除其
Git 仓库、Published Skill Package 与全部 DB 记录（含 Release、版本、Tag 与
名称重定向），Skill Identity 随即不可用且不可复用。只允许 ESL Platform
Administrator 执行，删除前要求显式确认。

## Unreleased Skill Source

尚未产生任何 Skill Release 的 Server-hosted Skill Source。经授权的 Skill User
可以下载和修改其源码，但不能将它作为技能安装。

## Published Skill Package

发布 Skill Release 时生成的、不可变且带 Namespace 的安装产物。远程安装消费
该产物，而非源码仓库；它绑定产生该 Release 的源码 commit，发布后不可覆盖或
删除。

## Release Manifest

Server-hosted Skill Source 中随源码一起进行 Git 管理的 `release.json`。它声明
服务器生成 Skill Release 和 Published Skill Package 时所需的发布属性，包括
`schemaVersion`、许可证、搜索关键词、兼容性约束和技能依赖，但不记录 SemVer、
源码 commit、checksum、发布时间或发布状态。发布时，服务器从目标源码 commit
读取并校验该清单，将其内容固化为该 Skill Release 的元数据快照；后续源码修改
不影响已经创建的 Skill Release。除 `license` 外，其余字段允许为空集合，但
字段本身必须存在。它是**发布链**的清单：只被 `upload` / `publish` 与服务器
发布流程消费，源目录之外不出现于本地安装或适配链路。

_Avoid_: Skill Release，用于指代该文件时。

## Skill Manifest

已安装技能的**安装副本**或 **Published Skill Package** 中携带的 `skill.json`。
它记录技能身份、SemVer 版本、描述、作者与可选的关键词、兼容性、依赖等
元数据，供 `install`（本地副本）、`adapt`、`version`、`list` 等本地消费链路
读取。它只在两种生成物中出现：本地安装时的技能包副本，以及服务器发布时生成
的 Published Skill Package（由 ESL Server 写入，见 ADR-0007）；**它不进入
Server-hosted Skill Source 源码**，也不作为发布输入。

_Avoid_: 用 Skill Manifest 指代源码中的清单；源码中的发布清单是
Release Manifest（`release.json`）。

## Release Dependency Lock

服务器在发布时为每个 `release.json.dependencies` 解析出的精确依赖结果。它把
依赖的 Skill ID、固定版本和制品校验值保存为该 Skill Release 的锁定图，确保
同一 Release 之后任何时间安装都解析到同一组已发布技能。

## Release Tag

Skill Release 创建成功后，由 `publish` 在 Server-hosted Skill Source 中创建并
推送的 annotated Git tag，格式为 `v<SemVer>`。它指向 Skill Release 绑定的
源码 commit，帮助用户在 Git 历史中定位发布源码，但不是 Skill Release 或
Published Skill Package 的事实来源。Release Tag 推送失败不使已经创建的
Skill Release 失效；后续发布重试可以在确认 commit 一致后补建或补推该 Tag。

_Avoid_: Skill Release，用于指代 Git tag 时。

## Platform Organization

ESL 初始化时配置的唯一组织。它是全部 Skill User 的共享源码仓库空间，并为
每个 Server-hosted Skill Identity 提供 Namespace；正常运行期间不得变更。

## Local Scope

保留 Scope `local`，用于从 Local Skill Source 安装的 Skill Identity。
`@local/*` 将本地路径来源的技能与从 ESL Server 安装的技能区分开。它不是
Namespace，不参与 Skill Rename，不可 `publish`。

## Built-in Scope

保留 Scope `builtin`，用于由 ESL CLI 发行包直接携带的 Built-in Skill。
`@builtin/*` 将内置技能与 Server-hosted 技能和本地草稿区分开。它不是
Namespace，不参与 Skill Rename，不可 `upload`、`publish`、`source`、
`version` 或 `rename`。

## Built-in Skill

由 ESL CLI 发行包直接携带的只读技能资源。它不属于 Server-hosted Skill，
不创建 Skill ID、Git 仓库、Skill Release 或 Published Skill Package，也不
出现在 ESL Server 搜索结果中。用户仍通过 `install` 将其安装到项目或全局
技能目录；其来源不需要登录或网络。

## Client-coupled Built-in Skill

随 ESL CLI 版本一起发行的 Built-in Skill。每个 ESL CLI SemVer 携带同一 SemVer
的固定技能内容；该内容只随 CLI 发行更新，不可通过 Source Upload、Git push
或 `publish` 独立修改。当前 Client-coupled Built-in Skill 为 `esl-operator`。
Skill User 只能安装与本机 ESL CLI 完全相同版本的此类技能。ESL CLI 升级时自动
更新已安装的全局副本及其 ESL 管理的适配输出；项目级副本不自动更新，必须在该
项目中显式执行 `update`。自动同步由 CLI 的 npm lifecycle 触发，只更新用户
已经显式安装的全局副本，不自动首次安装；同步失败不阻断 CLI 安装，并在下一次
CLI 执行时重试。CLI 降级时全局副本也同步降级。

## Built-in Skill Package

ESL CLI 构建时从 Built-in Skill 源码生成并随 npm 包发布的本地安装产物。它包含
`SKILL.md`、支持文件、由 CLI 版本生成的 `skill.json` 和内容校验元数据。它不
属于 Published Skill Package，安装身份为 `@builtin/<skill-name>`，并在
锁文件中以 `source: "builtin"` 与 `builtin:<skill-name>` 标识。
`skill.json` 的 SemVer（含 prerelease 标识）必须严格等于当前 `@esl/cli`
的版本，构建与 npm 发布前校验。

## Local Skill Source

The original local directory where a skill is authored or maintained before it
is installed into a project skill store. A Local Skill Source contains
`SKILL.md` and, for source-form skills, a Release Manifest (`release.json`); it
does not contain a Skill Manifest (`skill.json`), which is only produced into
an installed copy or a Published Skill Package.

## Skill Identity

The current full skill name in the form `@scope/skill-name`. For Server-hosted
skills the scope is its Namespace; for reserved scopes it is `local` or
`builtin`. It can change only through Skill Rename; Skill ID is the stable
identifier across renames.

## Skill Release

A specific published version of a Skill Identity that can be discovered,
installed, updated to, or used by a Skill User. It is created from a specific
source commit of a Server-hosted Skill Source. Published Skill Source may
continue to change, but only a new Skill Release can affect installation or
update.
_Avoid_: version when referring to the installable skill artifact.

## Adapted Skill Directory Name

The scope-qualified directory name used for a skill in an AI tool's adapted
skill directory. It uses `scope_skill-name`, such as `cnfox_code-review`, so
the scope boundary remains unambiguous while staying within a single
tool-scanned directory level.

## Adapted Skill Display Name

The scope-qualified name written into an adapted skill's `SKILL.md`
frontmatter for AI tools to display or identify the skill. It uses
`scope:skill-name`, such as `cnfox:code-review`.

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
