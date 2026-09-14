# Context

## Scope

Skill Identity 形式 `@scope/skill-name` 的第一段。它是机械层概念，无治理
含义；adapt 引擎按它生成安装目录名与展示名。Scope 分两类：Namespace（由
Organization 或 Skill User 占用，ADR-0032），以及保留 Scope（`local`、
`builtin`）。

## Namespace

由 Organization 或 Skill User 占用的 Scope，组织名或用户名即 Namespace。
所有 Namespace 名共享一个全局扁平名字池：组织名与用户名先到先得，保留名
（`local`、`builtin`、`admin`、`api`、`git`、`system`）不可用，且一经占用
不得改名（ADR-0032）。技能可见性不再由 Namespace 决定，而是逐技能的
Public/Private 设置（见技能可见性）。在 `@acme/code-review` 中，Namespace
是 `acme`；在 `@cnfox/my-skill` 中，Namespace 是个人命名空间 `cnfox`。
保留 Scope 不是 Namespace。

## 个人命名空间 (Personal Namespace)

每个 Skill User 注册成功后自动获得的、与其用户名同名的 Namespace
（`@用户名`）。它无需申请，是个人发布技能的默认归属；Release Manifest 中
不带 scope 的 `name` 即指个人命名空间，显式写 `@自己的用户名/...` 与之
等价（ADR-0032）。

## Skill Source Lifecycle

## Skill ID

服务器为服务器托管技能生成的不可变标识。Owner、公开名称或 Git 仓库地址变化
时，仍以它作为查找键。它在首次 Source Upload 时生成，即使技能尚未产生
Skill Release 也一直存在。其格式为带 `sk_` 前缀的 ULID。

## Skill Rename

平台管理员或 Owner 对 Server-hosted Skill Identity 执行的显式改名操作。
Rename 只改短名，不改 scope 段；技能不得跨命名空间移动（ADR-0032）。
Skill ID 保持不变，旧 Identity 永久重定向到新 Identity。普通 Git push
不得直接改变 `SKILL.md.name` 或技能身份；名称变更必须经过该流程。使用旧
Identity 安装时，客户端提示迁移到新 Identity；指定历史 Release 时仍允许
安装旧包。旧 Identity 永久保留且不得被其他技能复用。

## Skill Update Migration

已安装技能因 Skill Rename 而产生新 Identity 时，`update` 基于同一个 Skill ID
自动迁移本地安装目录、依赖键、锁文件和适配输出的操作。固定旧 Release 的
安装不受影响。

## 技能描述 (Skill Description)

Server-hosted Skill 的展示性一句话元数据，由 Source Upload 从源码登记，随后续 Source Update 更新。它描述当前源码，不属于任何 Skill Release 的固化内容；每个 Published Skill Package 携带的是自己发布时刻的描述快照。
_Avoid_: Release 描述（当指技能当前描述时）。

## Server-hosted Skill Source

技能上传至其 Namespace 所有者名下（Organization 或 Skill User 的个人仓库）
后形成的协作维护源码仓库（ADR-0024、ADR-0032）。
它独立于 Skill Release 存在；其 Skill Identity 由服务器记录，源码中的
`SKILL.md.name` 保持短名并与服务器记录的当前短名一致。源码以
`SKILL.md` 与 Release Manifest（`release.json`）为内容；它不包含 Skill
Manifest（`skill.json`），后者只作为安装副本或 Published Skill Package 的
生成物存在。

## Source Upload

把本地技能源码提交并推送到服务器成为 Server-hosted Skill Source 的
esl 化操作：首次创建 Skill ID 与服务器 Git 仓库——技能身份取自 Release
Manifest 的 `name` 字段（ADR-0032），指向组织命名空间时服务器校验上传者
是该组织成员；之后对已托管源（已有
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

## Server Origin 迁移 (Server Origin Migration)

ESL Server 的用户可见 origin（`scheme://host[:port]`，即 Single User-Facing
Server URL 的寻址部分）发生变化，而 Registry 与 Git Backend 的数据整体保留：
所有 Skill ID、Skill Identity、Git 仓库路径与 Skill Release 均不变。已安装副
本与 install/update/use/source 等消费链路在 `config set-server` 后自动跟随新
origin；持有旧 Source Remote 的本地源目录则依赖 Source Remote 重指修复。
_Avoid_: 换服务器、重新部署、重装（当指数据整体搬迁时）。

## Source Remote 重指 (Source Remote Rehoming)

CLI 在 Server-hosted Skill Source 目录中检测到 Source Remote 的 origin 与当前
配置的 ESL Server origin 不一致时，先向当前 ESL Server 验证 Skill Identity 存
在且 Git 仓库路径与旧路径一致，验证通过后把 Source Remote URL 中失效的
origin 替换为新 origin 的自动修复动作。验证不通过时按可行动错误处理，绝不重
新注册、绝不接管（不创建新 Skill ID，不删除既有 Source Remote）。
_Avoid_: 重新注册、接管（adopt，ADR-0021 语义）。

## 源链接重置 (Source Link Reset)

把一个已托管目录（拥有 Source Remote 的本地技能源目录）还原为未托管
Local Skill Source 的本地操作。它移除 Source Remote，并把 Release Manifest
改名保留（`release.json.before-reset`），使后续 Source Upload 按新源重新
登记、生成新的 Skill ID。它不触碰服务器：不删除任何服务器侧资产，也不
自动重新登记——重新上传始终是显式的后续步骤。执行前有守门：当该身份在服务器上对当前登录仍可见时，拒绝
执行并指引核实（切维护账号同步，或走 Archived/Deleted 流程删除）；仅
`--force` 可越过该阻断。探测失败（身份不可见或不可达）时静默执行。
_Avoid_: 清理；接管（adopt，ADR-0021 语义）；orphan 重新注册。

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
Administrator 执行，删除前要求显式确认。「Skill Identity 不可复用」这一承诺
以 Registry 数据存在为前提：同址的服务端数据整体丢失或重建（如开发期的
Bootstrap Reset）时，承诺无法延续，同一 Identity 物理上可作为全新源再次
登记，产生新的 Skill ID。

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
`schemaVersion`、`name`（v3 起必填的完整 Skill Identity，技能归属的唯一权
威来源，ADR-0032）、`version`（SemVer，随源码走 Git 历史，见 ADR-0030）、许可
证、搜索关键词、兼容性约束和技能依赖，但不记录源码 commit、checksum、发布
时间或发布状态。发布时，服务器从目标源码 commit
读取并校验该清单，断言 `name` 与技能既定身份一致（归属变更不得借发布顺
车，ADR-0032），将其内容固化为该 Skill Release 的元数据快照；后续源码修改
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

Skill Release 创建成功前后，由 `esl version` 在本地源码中创建、随 push 上行
至 Server-hosted Skill Source 的 annotated Git tag，格式为 `v<SemVer>`。它
指向 Skill Release 绑定的源码 commit，帮助用户在 Git 历史中定位发布源码，
但不是 Skill Release 或 Published Skill Package 的事实来源。`publish` 校验
其存在且指向被发布的 commit；缺失时由服务器补建（`repair-tag` 兜底），补建
失败不使已经创建的 Skill Release 失效。

_Avoid_: Skill Release，用于指代 Git tag 时。

## Organization

npm 式组织实体，直接映射为底层 Gitea 的一个 Organization，为其名下技能
提供 Namespace（`@scope/skill-name` 中的 scope 段）。任何 Skill User 可
创建多个组织，创建者自动成为组织管理团队的初始成员。组织创建方式由平台设置
`org_registration_mode` 决定：`auto` 同步即时创建；`manual` 走组织注册
申请（ADR-0032）。拉人进组织的方式（邀请制 / 直接添加）为平台设置，切换权
在 Super Administrator。
_Avoid_: Tenant Organization（旧称）。

## 组织注册申请 (Org Application)

`manual` 模式下 Skill User 从个人控制台提交的创建组织申请。提交时即查重：
组织名已存在、或已有同名待审申请时直接拒绝，冲突不会到达审批环节；Super
Administrator 拒绝申请即释放该名字。申请不可撤回，申请人可在个人控制台查看
待审状态。批准后组织同步创建，申请人成为组织管理团队初始成员（ADR-0032）。

## 组织成员 (Organization Member)

属于某个 Organization 但不属于其组织管理团队的 Skill User。成员加入组织时自动
加入组织只读、读写、技能管理三个常设团队，离开时自动移出；对组织内 private
技能默认没有任何权限（ADR-0032）。组织成员身份不是平台角色（见平台角色）。
_Avoid_: 普通成员、普通用户。

## 组织邀请 (Org Invitation)

`invite` 拉人方式下加入 Organization 的凭据。它由组织管理团队成员发起，被邀请
人在个人控制台接受或拒绝，发起人可撤销；接受后才成为组织成员并自动加入三个
常设团队。未接受的邀请不产生任何 Git Backend 成员关系。
_Avoid_: 成员邀请、入组邀请。

## Organization Deletion State

Organization 删除任务的生命周期状态，包括 `deleting`、完成和 `delete_failed`。处于 `deleting` 或 `delete_failed` 的组织禁止正常登录及资产变更，直到删除完成或由 ESL Platform Administrator 恢复处理。删除由组织管理团队成员发起并要求显式确认，ESL Platform Administrator 保留治理兜底。删除完成后该组织名归还扁平名字池，可被新的组织或用户占用（ADR-0034）。

## Skill User Password Policy

ESL 对 Skill User Credential 施加的密码规则，其权威来源为运行中的 Gitea 配置。ESL 在客户端与服务端提前执行同一规则，Gitea 保留最终校验权。

## 平台角色 (Platform Role)

平台的全局角色轴，恰好两个取值：Super Administrator 与 Skill User。组织内不
存在角色——组织治理权由组织管理团队的成员身份承载，它是团队身份而非角色
（ADR-0033）。
_Avoid_: 组织管理员（当指平台角色时）；普通用户、普通成员（当指平台角色时）。

## 组织管理团队 (Org Management Team)

Organization Team 之一，即该 Gitea Organization 的 Owners 团队；组织创建者
自动成为初始成员。成员持有该组织最高管理权：管理成员、团队与组织设置，可
见并管理本组织名下全部技能，并可删除组织（ADR-0033、ADR-0034）。成员之间可以
互相移除——不能移除自己，且团队必须至少保留一名成员；ESL Platform Administrator
不经组织成员身份也有同款移除能力（治理兜底），但同样不破"至少保留一名"这条
不变量——无主组织不是可治理状态，确实无人可用的组织走整体删除。
`<org>_admin` 专用管理账号与系统管理团队已随多租户账号模型废止。
_Avoid_: 组织管理员（当把它当作平台角色时）。

## Organization Team

组织内部的团队，映射为 Gitea Organization 内的 Team。每个团队具备固定的
技能访问级别（Read、Write 或 Manage），是技能权限矩阵中的批量授权载体；
团队由组织管理团队成员管理。每个组织创建时自动生成四个常设团队：组织只读
团队（Read）、组织读写团队（Write）、组织技能管理团队（Manage）与组织管理
团队（Owners，见其词条）；成员加入组织时自动加入前三个常设团队，离开组织
时自动移出。常设团队不可删除、不可改名；自定义团队可创建、改名、删除（ADR-0032）。

## 团队标识名 (Team Identifier)

Organization Team 的机器名，仅含小写字母、数字与连字符，是团队的唯一键与授权对象。它在 ESL 与 Git Backend 中保持一致（即 Gitea Team Name），默认团队识别与权限面板授权均以它为准；界面展示优先用团队显示名。标识名变更（重命名）是治理动作。
_Avoid_: 团队名（当指团队显示名时）。

## 团队显示名 (Team Display Name)

Organization Team 面向人的展示名，与团队标识名解耦，可用中文。它是纯展示概念，不参与唯一性、默认团队识别或授权判定；未设置时回退展示团队标识名。常设团队由平台预置显示名（如 `all-managers` → 组织技能管理团队）。
_Avoid_: 团队名（当指团队标识名时）。

## 技能可见性 (Skill Visibility)

逐技能设置的开放程度，由组织管理团队成员或技能 Maintainer 切换。`public`：
平台内所有 Skill User 都可搜索、安装；`private`（默认）：仅 Maintainer 与
被授权的团队、成员可见可安装。组织成员对组织内 private 技能默认没有任何
权限，授权通过共享给常设团队或逐技能添加团队、成员实现（ADR-0032）。

## Super Administrator

ESL 技能库平台的全局超级管理员（对应 Gitea 中的 `GITEA_ADMIN_USERNAME`，如 `eslroot`）。超越于单个组织之外，拥有审批组织注册、配置平台策略、全平台组织管理与全局治理兜底权限。它不属于任何 Organization，不持有个人控制台，也不以个人命名空间发布技能（ADR-0033）。

## 管理后台 (Admin Console)

ESL 面向浏览器操作的 Web 管理界面，位于 `/admin/` 路径下。它承载两类视角：
Super Administrator 控制台（`/admin/super/`，申请审批与平台设置）与个人控制台
（跨命名空间聚合的技能视图与组织管理——创建与删除组织、成员与团队管理、组织
名下技能管理，按 managed/shared 标注），通过 ESL Server 的 Registry API 完成
登录、注册与治理操作。组织管理不是独立视角：治理入口只对组织管理团队成员渲染，
其余成员看到该组织时是只读的。登录角色由 ESL Server 判定并随登录响应返回，
客户端不自行按命名约定推导。
_Avoid_: Web Console，当指代该 Web 界面时（易被误解为网页终端）；后台，当单独指代 ESL Server 或 Git Backend 时。

## 个人控制台 (Personal Console)

管理后台中面向 Skill User 的视角：跨命名空间聚合的技能视图与组织管理。组织
**不是隐式上下文**——组织管理以「我的组织」列表为入口，对一个组织的一切操作
都显式指名该组织。治理入口只对组织管理团队成员渲染，其余组织成员看到的是只读
视图。菜单集合为四项：概览（默认落地页）/ 我的组织 / 技能 / 邀请。
_Avoid_: 个人中心、个人后台、成员控制台。

## 概览页 (Overview)

个人控制台的默认落地页，聚合跨切面的状态：待办（待接受的邀请、待审的组织申
请）、我的组织、我管理的技能。它是"我"在平台上的首页。
_Avoid_: 仪表盘（当指个人控制台首页时）、控制台首页。

## 技能管理页面 (Skill Management Page)

管理后台中面向单个 Server-hosted Skill 的管理界面：承载其权限矩阵的查看与配置（团队授权与成员授权，含对常设团队的授权）与技能可见性切换，由 Super Administrator 控制台与个人控制台共用；个人视角按其权限决定可写或只读。
_Avoid_: 技能权限页面、权限页（旧称）。

## 技能列表页 (Skill List Page)

个人控制台中跨命名空间聚合的技能列表，展示"我"有关系的全部技能——个人命名
空间与所有所在组织——并以命名空间筛选（个人命名空间排在最前）。组织详情页的
「技能」页签是同一个列表锁定到该组织命名空间的视图，内容与权限判定同源，仅入
口与预设筛选不同。
_Avoid_: 我的技能、个人技能（当指该跨命名空间列表时）。

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
skills the scope is its Namespace (held by an Organization or the publishing
Skill User); for reserved scopes it is `local` or `builtin`. It is declared in
the Release Manifest `name` field and fixed at first Source Upload; `publish`
asserts it has not changed. It can change only through Skill Rename (short
name only — never across namespaces, ADR-0032); Skill ID is the stable
identifier across renames.

## Skill Release

A specific published version of a Skill Identity that can be discovered,
installed, updated to, or used by a Skill User. It is created from a specific
source commit of a Server-hosted Skill Source, and its version is frozen from
that commit's Release Manifest (`version` field, ADR-0030). Default resolution
(install/update/use without `--version`) selects the highest stable SemVer and
excludes prereleases; prerelease versions are installable only by explicit
`--version`. Published Skill Source may continue to change, but only a new
Skill Release can affect installation or update.
_Avoid_: version when referring to the installable skill artifact.

## Deprecated Release

被 Maintainer 显式标记为「不推荐」的 Skill Release。标记携带一段劝退说明；
安装与解析命中该版本时打印警告，但不阻止安装，也不影响最新版推导。它是
不可变发布模型的配套手段：坏版本（安全缺陷、内容错误）保留可追溯性的同时
对消费者给出明确劝退信号，弥补「不可变 + 单版本不可删」下坏版本只能沉默存
在的缺口。传空说明可解除标记。

## 单版本删除 (Release Deletion)

删除单个 Skill Release 的外科手术式操作：移除其 Published Skill Package
文件、release 记录、version 条目与对应的 Release Tag，但保留源码 Git 历史、
技能本身与其余版本。技能 Maintainer 即可执行，前提是无其他技能的 Release
Dependency Lock 引用该版本且显式确认；被引用的版本仅 ESL Platform
Administrator 可强制删除（依赖检查降为强警示）。被删除的版本号视为烧毁，
不得重发。与 Deleted Skill 的整技能物理删除相对（ADR-0030 对 ADR-0014 的
版本级细化）。

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

对该技能持有管理权（Manage Permission）的用户或团队。管理权涵盖：修改
Server-hosted Skill Source、发布 Skill Release、配置技能权限（授权与可见
性），以及授予和撤销他人的管理权。技能创建者自动成为初始 Maintainer——
在组织命名空间下，任何组织成员都可创建技能；管理权可授予组织成员或
Organization Team，也可被撤销。

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
maintain skills according to their permissions. 身份全局唯一（即 Gitea 用户
名，无组织前缀），通过用户注册获得，可同时属于多个 Organization，注册成功
即拥有个人命名空间（ADR-0032）。

## 用户注册 (User Registration)

Skill User 自助创建全局账号的入口（服务端经 Git Backend 管理员 API 创建
账号，用户自设密码）。模式由平台设置 `registration_mode` 决定：`open`
（默认）注册即用；`approval` 需 Super Administrator 审批激活（ADR-0032）。

## Skill User Credential

A username and password pair that a Skill User presents to log in to ESL. The
password is hosted and validated by Gitea; ESL never stores the password
itself.

## Skill User Password Change

The Skill User's self-service action to replace their own password. It requires
the current password and takes effect in Gitea.
_Avoid_: password reset

## Bootstrap

The first-run process that prepares the ESL Docker runtime with the platform
state required before normal users can operate it.

## Bootstrap Reset

将 ESL 本地运行环境恢复为干净状态的破坏性流程：停掉 Docker 运行时，删除
API 数据库、Gitea 数据与 Bootstrap 机密三个持久数据卷，再重新执行
Bootstrap，借助首启初始化路径重建数据库 schema 与 Gitea 管理员。它由宿主机
命令显式触发（`npm run reset:dev`，见 `scripts/reset-dev-env.mjs`），仅用于
开发与测试环境，不属于正常用户操作面，绝不自动触发。与 Bootstrap 的区分：
Bootstrap 从干净状态准备平台状态（幂等、无破坏）；Bootstrap Reset 先破坏性
清空再准备，必须由操作者确认。
_Avoid_: Bootstrap，当指代"清空后重新初始化"时。

## Bootstrap Secret Volume

The Docker volume that stores the internal Gitea administrator token generated
by Bootstrap for API use.

_Avoid_: user token, Skill User token

## Bootstrap Token

已退役的 ESL 平台管理员 CLI 登录凭据。在多租户组织模型下（见 ADR-0020），
ESL CLI 只服务组织内成员，平台管理员通过管理后台以 ESL Administrator
Account 密码登录，不再使用静态 bootstrap token 作为人用登录凭据；`esl
login` 也不再接受无组织账号。
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
