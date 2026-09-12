Status: ready-for-agent

> **部分约束已被 [ADR-0030](../../docs/adr/0030-semver-in-source-and-npm-style-release-workflow.md) 取代（2026-09-12）**：本 spec 的「SemVer 只作 `publish` 参数、源码不携带版本」「publish 拒绝未推送的 HEAD」「Release Tag 由服务器创建」三条已不再成立——SemVer 现由 `release.json` 的 `version` 字段承载，`esl version` 负责递增并打 tag，`publish` 对已托管源自动同步。下方对应条目已就地标注，实现请以 ADR-0030 与 CONTEXT.md 为准，本 spec 仅作为历史设计记录保留。

## Problem Statement

ESL 当前把源码托管、版本发布和技能安装混在同一个 `publish` 流程中。服务器没有稳定的 Skill ID，未发布源码无法作为独立对象协作管理，远程 `install` 直接从 Git 仓库获取内容，且发布时无法生成与 Namespace 一致的不可变安装产物。

这会导致用户无法清晰地区分“上传并协作维护源码”和“发布可安装版本”，也无法安全处理技能改名、Git 地址变化、Owner 或 Maintainer 变化，以及已经安装技能的后续更新。

## Solution

建立完整的 Server-hosted Skill Source 生命周期：

1. Bootstrap 时配置唯一的 Platform Organization，并将其作为所有远程技能的稳定 Namespace；运行后不提供常规变更入口。
2. 已登录 Skill User 使用 `upload` 首次上传本地技能，服务器生成 `sk_` 前缀 ULID 格式的 Skill ID、创建组织内 Git 源码仓库，并将服务器登记的身份规范化为 `@组织/skill-name`。
3. 上传后的技能进入 `Active Unreleased Skill Source` 状态。所有已登录用户可下载源码，只有 Maintainer 可 push；未发布源码不可 `install`。
4. 后续源码修改通过 Git `Source Update` 完成，`upload` 不覆盖已有服务器源码。
5. Maintainer 从明确的源码 commit 发布唯一 SemVer 的 Skill Release。发布生成不可变的 Published Skill Package；远程 `install` 只消费该包，不直接 clone 源码仓库。
6. 发布包包含 Namespace 化身份：安装目录使用 `namespace_skill-name`，`SKILL.md.name` 使用 `namespace:skill-name`；源码仓库保持短名 `skill-name`。
7. 已安装技能通过 Skill ID 追踪版本和重命名。重命名后的 `update` 自动迁移本地目录、依赖键、锁文件和适配输出。
8. 技能只能进入 `Archived`，初期不允许物理删除；未发布技能不会因为未发布自动归档。

## User Stories

1. As an ESL Platform Administrator, I want to configure one Platform Organization during Bootstrap, so that all remote skills have one stable Namespace.
2. As an ESL Platform Administrator, I want the Platform Organization to be immutable during normal operation, so that existing skill identities and repository mappings do not drift.
3. As an ESL Platform Administrator, I want organization migration to require an explicit data migration or redeployment process, so that accidental Namespace changes are impossible.
4. As a Skill User, I want to upload a local skill to the ESL Server, so that its source can be managed centrally.
5. As a Skill User, I want upload to create a stable Skill ID immediately, so that an unreleased skill can still be referenced and governed.
6. As a Skill User, I want upload to create a Git repository in the Platform Organization, so that collaborators can use normal Git workflows.
7. As a Skill User, I want upload to add an `esl` remote without replacing `origin`, so that my existing source host remains intact.
8. As a Skill User, I want the server to assign the Platform Organization Namespace while keeping source `SKILL.md.name` as the short name, so that server identity and authoring representation remain distinct.
9. As a Skill User, I want the uploader to become the initial Maintainer, so that the new source has an immediate owner for collaboration and release.
10. As a Skill User, I want an existing server skill upload to fail instead of overwriting source, so that `upload` remains a create-source operation.
11. As a Skill User, I want to update an uploaded skill through Git commits and push, so that source history remains reviewable.
12. As a Skill User, I want all authenticated users to download an unreleased source by explicit identity or Skill ID, so that teams can experiment without making drafts discoverable.
13. As a Skill User, I want only Maintainers to push source changes, so that other users cannot overwrite a shared skill.
14. As a Skill User, I want an unreleased source to be unavailable to `install`, so that drafts are not mistaken for supported releases.
15. As a Skill User, I want `source` to work for both unreleased and published skills, so that source collaboration is independent from installation.
16. As a Skill User, I want `source` to default to the current `main` branch, so that I receive the latest collaborative source.
17. As a Skill User, I want `source` to accept an explicit Git ref or Release, so that I can reproduce historical source content.
18. As a Maintainer, I want to publish the current local HEAD after it has been pushed to the ESL Source Remote, so that each release is reproducible and corresponds to the source state I am viewing.
18a. As a Maintainer, I want Git push to synchronize source without creating a Skill Release, so that source collaboration and public release remain independent.
18b. As a Maintainer, I want publish to consume the current HEAD only after that commit exists in the server repository, without implicitly pushing local changes, so that release creation cannot leave partially synchronized source state.
18c. As a Maintainer, I want publish to reject a dirty worktree, so that uncommitted local changes cannot be mistaken for released content.
18d. As a Maintainer, I want the first release flow to require `local HEAD == esl/main`, so that the source commit used for publishing is unambiguous.
19. As a Maintainer, I want every Skill Release under one Skill ID to use a unique SemVer, so that version resolution and locks are unambiguous.
20. As a Maintainer, I want an existing SemVer to be rejected, so that a published package can never be overwritten.
20a. As a Maintainer, I want the Release Manifest to be versioned and validated, so that its format can evolve without ambiguous parsing.
20b. As a Maintainer, I want release dependencies to be resolved and locked at publish time, so that an existing Release never changes its dependency graph.
20c. As a Maintainer, I want cyclic release dependencies to be rejected, so that installation does not produce an invalid dependency graph.
21. As a Skill User, I want a published skill to become discoverable through the Registry API, so that I can find supported releases.
22. As a Skill User, I want `install` to reject unreleased skills, so that installation only consumes published packages.
23. As a Skill User, I want `install` to download a Published Skill Package instead of cloning source, so that installed content is immutable and release-shaped.
23a. As a Skill User, I want compatibility checks to block incompatible installs by default, so that a package is not installed into an unsupported environment.
23b. As a Skill User, I want to explicitly bypass compatibility checks for a complete dependency tree, so that I can test unsupported packages while receiving warnings and recording the bypass.
24. As a Skill User, I want installed project dependencies to keep the logical identity `@namespace/skill-name`, so that manifests remain readable and stable.
25. As a Skill User, I want the physical project directory to use `namespace_skill-name`, so that the namespace boundary is safe in a single directory level.
26. As a Skill User, I want the published package's `SKILL.md.name` to use `namespace:skill-name`, so that AI tools can distinguish skills with the same short name.
27. As a Skill User, I want source `SKILL.md.name` to remain the short name, so that source validation and authoring remain independent from tool adaptation.
28. As a Skill User, I want local skills to keep the `local` Namespace until upload, so that local and server sources remain distinguishable.
29. As a Skill User, I want an installed skill to update to a newer Release, so that supported fixes and features can be adopted.
30. As a Skill User, I want a fixed old Release to remain unchanged, so that reproducible installs are not silently altered.
30a. As a Skill User, I want an existing Release with a missing Git Release Tag to be repairable without re-publishing or uploading local source, so that repository navigation can be restored safely.
31. As an Owner or Maintainer, I want a skill rename to be an explicit operation, so that a normal source edit cannot accidentally change the public identity.
32. As an Owner or Maintainer, I want a push that changes `SKILL.md.name` or skill identity to be rejected with a rename-flow message, so that metadata cannot drift.
33. As an Owner or Maintainer, I want rename to synchronize source `SKILL.md`, the server identity, the Git repository name, and the redirect, so that all representations remain consistent.
34. As a Skill User, I want old identities to remain permanently reserved, so that a renamed skill cannot be confused with a different skill.
35. As a Skill User, I want an install request using an old identity to explain the rename instead of silently selecting a new latest version, so that compatibility changes are explicit.
36. As a Skill User, I want to install a historical Release through an old identity, so that old environments remain reproducible.
37. As a Skill User, I want `update` to recognize a renamed skill by Skill ID, so that a rename does not create a second installed skill.
38. As a Skill User, I want `update` to migrate the physical directory, dependency key, lock entry, and adapted output after a rename, so that local state follows the same skill.
39. As an Owner or Maintainer, I want published source to continue accepting normal source updates, so that development can continue after a release.
40. As an Owner or Maintainer, I want source changes to affect installation only after a new Release, so that published artifacts remain stable.
41. As a Skill User, I want a skill to be explicitly archived, so that obsolete skills leave default search and release flows without losing history.
42. As a Skill User, I want an unreleased skill to remain active by default, so that lack of a Release does not destroy collaborative drafts.
43. As an ESL Platform Administrator, I want only the platform administrator to restore an Archived Skill, so that lifecycle recovery remains governed.
44. As an ESL Platform Administrator, I want no initial physical deletion path, so that Skill IDs, Git history, packages, redirects, and audit records remain recoverable.
45. As an ESL Platform Administrator, I want governance fallback over abandoned skills, so that disabled or unreachable Maintainers do not permanently block recovery or administration.

## Implementation Decisions

- Use the existing ESL Server, CLI, Core, Git Backend, and SQLite-backed service model as the integration boundary; do not introduce an unrelated service.
- Use the authenticated CLI-to-ESL-Server workflow as the primary external seam: CLI gathers local Git state and sends a publish request; the server resolves the source commit, validates the Release Manifest, creates the Release and Published Skill Package, locks dependencies, and coordinates the Release Tag. Test lower-level Core and Git Backend adapters only where the primary seam cannot observe the contract.
- Add a persisted Skill ID generated at first Source Upload. Use a `sk_` prefix followed by a ULID. The Skill ID exists before the first Skill Release and remains stable across rename, Owner change, Maintainer change, and Git repository rename.
- Model the Platform Organization as one bootstrap-time configuration value. It supplies the Namespace for all Server-hosted Skill Identities and cannot be changed through normal CLI or Registry API operations.
- Separate Server-hosted Skill Source, Skill Release, and Published Skill Package as distinct lifecycle concepts. A source repository is mutable; a Release and its package are immutable.
- Split CLI responsibilities into `upload`, `source`, `publish`, `install`, `update`, and an explicit `rename` flow. `upload` creates only new server source; later changes use Git push.
- On first upload, create the organization repository, assign the server-side Skill Identity as `@platform-organization/skill-name`, preserve the source `SKILL.md.name` short name, add an `esl` remote, and leave any existing `origin` unchanged.
- Grant authenticated Skill Users repository-creation capability in the Platform Organization. The uploader becomes the initial Maintainer. Only Maintainers may push and publish; the ESL Platform Administrator retains governance fallback.
- Make unreleased sources readable to authenticated users by explicit identity or Skill ID, but exclude them from default search and reject them from installation.
- Use `main` as the default source checkout ref for `source`. Permit an explicit Git ref or Skill Release for historical source checkout.
- Keep Source Update and Release creation as independent operations. A normal Git push only synchronizes source and never creates a Skill Release; `publish` never performs an implicit Git push.
- Require `publish` to run inside the Skill Source Git working tree, reject a dirty working tree, and publish its current local HEAD. The commit must already exist in the ESL Source Remote and must be exactly `esl/main`；~~reject an unpushed HEAD or a HEAD that is not on `esl/main` with guidance to push source first~~ **[被 ADR-0030 取代]** 对已托管源，`publish` 改为自动 `fetch`/rebase/push 后再发布（忘 push 不再阻断）；首次登记仍归 `esl upload`，缺 `esl` remote 时报错指路而非隐式建仓。`publish` 仍不支持发布任意 commit（无 `--commit`）。
- ~~Require a unique SemVer as an explicit `publish` argument. Source files and the Release Manifest do not carry the Skill Release version.~~ **[被 ADR-0030 取代]** SemVer 现在由 `release.json` 的 `version` 字段承载（`schemaVersion: 2`），由 `esl version` 递增并打 tag，`publish` 从源码读取——不再接收版本参数。
- Reject duplicate versions and never overwrite or delete a Published Skill Package. Bind the Release to Skill ID, SemVer, source commit, and package checksum.
- After the server successfully creates the Skill Release, create and push an annotated Release Tag named `v<SemVer>` to the ESL Source Remote. The server creates the tag so local Git identity does not matter. The tag points to the Release source commit but is not the Release source of truth. A tag push failure does not roll back the Release; a repeated repair can only recreate a missing tag when its commit matches the existing Release. **[ADR-0030 起]** tag 改由 `esl version` 在本地创建并随 push 上行，`publish` 校验其存在且指向被发布的 commit；服务端创建降级为兜底（`repair-tag` 不变）。
- Keep `skill.json` out of Skill Source. Require a Git-managed `release.json` Release Manifest containing `schemaVersion`, `license`, `keywords`, `compatibility`, and `dependencies`; require SPDX license expressions, allow `keywords`/`compatibility`/`dependencies` to be empty but present, resolve dependencies only to published remote Skill Releases, enforce compatibility by default, and do not allow publish-time arguments to override the manifest.
- Create and persist a Release Dependency Lock at publish time so the same Release always resolves the same dependency graph.
- Reject direct or indirect dependency cycles during publish.
- Treat `release.json` as part of the source commit: publish reads it from the current `HEAD`, and later changes affect only a future Release.
- Generate a Package Manifest named `skill.json` inside each Published Skill Package. It contains the server-generated Skill Identity, Skill ID, Release SemVer, source commit, package checksum, and the Release Manifest snapshot; it is never required in Skill Source.
- Store each Published Skill Package under an immutable package key derived from Skill ID, SemVer, and checksum. Existing package bytes and Release metadata are never overwritten or deleted.
- Create the Release Tag through the Git Backend after the Release is created. Missing tags may be repaired only against the recorded source commit; a conflicting tag is rejected.
- Treat an already existing SemVer as idempotent only for read/repair behavior: it cannot create a new package, replace metadata, or change the source commit.
- Generate the Published Skill Package at publish time. It must contain the Namespace-qualified installation identity and must be the only artifact consumed by remote install. The package must not mutate the source repository representation.
- Keep project dependency keys as `@namespace/skill-name`, while storing installed package directories as `namespace_skill-name`. Keep the package's `skill.json.name` aligned with the logical identity and rewrite the package `SKILL.md.name` to `namespace:skill-name`.
- Keep AI-tool-specific adaptation in the existing local adapt flow. Publishing creates one generic namespace-qualified package; it does not generate tool-specific packages.
- Validate on every accepted source push that `SKILL.md.name` matches the short name of the server-recorded identity. If the name changes, reject the push and instruct the user to use explicit rename.
- Implement rename as a server-governed operation that keeps Skill ID stable, updates source metadata, renames the Git repository, updates the current identity and Git mapping, and creates a permanent old-identity redirect. Old identities are never reusable.
- Make old-identity install requests explicit: report the rename rather than silently selecting the new latest Release; allow installation when the user explicitly selects a historical old Release.
- Make update resolution Skill-ID aware. When a rename is detected, migrate the local install directory, manifest dependency key, lock entry, and adaptation outputs while preserving a fixed old Release.
- Represent lifecycle states at minimum as active unreleased, published-capable active source, and Archived. Archiving blocks source updates and new Releases; restoring is administrator-only. Do not physically delete in the initial implementation.
- Extend server metadata and API responses so clients can distinguish Skill ID, current Skill Identity, source state, current Git URL, available Releases, and rename redirects.
- Keep CLI parsing, output, and exit behavior in `packages/cli`; keep identity, validation, package transformation, manifest, lock, and migration logic reusable in `packages/core`; keep authorization, persistence, Git Backend coordination, and Registry API behavior in `packages/server`.

## Testing Decisions

- Test external behavior through the highest existing seams. Prefer Fastify app/API tests for server contracts, public CLI command execution with injected fetch/Git/process dependencies for CLI behavior, and public Core adaptation/store functions for package and migration behavior.
- Extend server app tests to cover first upload, Skill ID creation, organization Namespace normalization, unreleased visibility, Maintainer authorization, publish-from-commit, duplicate SemVer rejection, package metadata, archived state, rename redirects, and administrator recovery.
- Extend Git Backend service tests to cover organization repository creation, repository rename, clean clone/package URLs, and push validation or hook coordination.
- Extend CLI upload/source/publish/install/update tests to cover remote creation, source checkout refs, unreleased-install rejection, package-based installation, release pinning, duplicate publish errors, rename messaging, and update migration.
- Verify that `publish` never pushes source branches, publishes only the current HEAD after it exists on `esl/main`, rejects a dirty worktree, and has no initial `--commit` override.
- Verify server-created annotated Release Tag creation after Release success, repair of a missing tag, rejection of a conflicting tag, and preservation of a successful Release when tag push fails.
- Verify release manifest schema versioning, empty-field handling, SPDX license validation, dependency cycle rejection, dependency lock persistence, and compatibility enforcement / ignore behavior.
- Extend Core schema and adaptation tests to cover package name rewriting, `namespace_skill-name` directories, `namespace:skill-name` display names, stable manifest keys, and removal or migration of old adapted outputs.
- Use existing publish, source, install, update, database, app, Git service, skill validation, file-copy, and adapt-engine tests as prior art.
- Test only observable contracts: returned metadata, HTTP status and payload, filesystem layout, Git command arguments, manifest and lock contents, and user-facing error messages. Avoid tests coupled to private helper structure.
- Add an end-to-end server-backed workflow covering upload, source collaboration, publish, package install, update, rename, and update migration with two ordinary Skill Users.
- Verify the complete repository with focused tests, `npm test`, and `npm run build`.

## Out of Scope

- Multiple Platform Organizations or changing the Platform Organization through normal product APIs.
- Anonymous public access, organization-specific visibility policies, approval workflows, teams, or enterprise audit UI beyond the required governance records.
- Replacing the Git Backend or exposing it as the normal user-facing service.
- Allowing `upload` to overwrite or synchronize an existing Server-hosted Skill Source.
- Installing or updating an unreleased source.
- Deleting historical Skill Releases or Published Skill Packages.
- Reusing old identities after rename.
- Tool-specific package generation during publish.
- Physical deletion of Archived skills in the initial implementation.
- A broad redesign of local-only skill authoring or Local Skill Source update semantics.
- Unrelated global-install behavior unless required to preserve the same package identity and migration contracts.

## Further Notes

The current implementation predates this separation: server creation and version registration are coupled to `publish`, server metadata is keyed primarily by name, and remote install clones the Git repository. The implementation should migrate these behaviors incrementally without silently changing existing local-source semantics.

The primary end-to-end seam is the authenticated CLI-to-ESL-Server workflow. Server API tests, CLI command tests, and Core adaptation tests should support that seam rather than becoming independent implementations of lifecycle rules.

The design follows the accepted single-Platform-Organization and Published Skill Package decision in ADR-0007, and the existing Skill Release lifecycle-before-release-schema decision. A dedicated Release schema may be introduced later, but this specification requires the user-visible lifecycle and identity contracts to be correct first.

`publish` remains a source-directory command because it must inspect local Git state and confirm the relationship between local `HEAD` and `esl/main`; it is still forbidden from pushing the source branch implicitly. The first implementation intentionally excludes publishing arbitrary historical commits. Historical source checkout remains available through `source`, while a future release may add an explicit server-side commit selection flow.
