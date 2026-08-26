# Built-in Skill 实现：CLI 内置技能打包、安装与自动同步

Status: ready-for-agent

## Problem Statement

ESL 的产品模型已经决定：`esl-operator` 是随 ESL CLI 版本严格配套的 Client-coupled Built-in Skill，而不是 Server-hosted Skill（ADR-0008）。它的唯一可编辑源码位于 `skills/esl-operator/`，安装身份为 `@builtin/esl-operator`，安装时从当前 CLI 包读取，不访问 ESL Server、不要求登录或网络。该技能不进入 Gitea，不创建 Skill ID、Git 仓库、Skill Release 或 Published Skill Package，不出现在服务器搜索结果中，也不可 `upload`、`publish`、`source`、`rename` 或 `version`。

但这一决策**尚未实现**。当前 CLI：

- `executeInstall` 只有两条路径：本地路径（`installFromLocalPath`）与服务器路径（`installFromServer`），没有任何 Built-in 分支；`installFromServer` 强制 `requireFreshToken`，而 Built-in 安装不得要求登录或网络。
- `@esl/cli` 的构建只有 `tsc`（`packages/cli/package.json` 的 `build`），没有从 `skills/esl-operator/` 生成并打包 Built-in Skill Package 的步骤。
- 锁文件 schema（`SkillsLockEntry`）没有 `source` 字段，`listSkills` 只支持 `registry | local` 两种来源；ADR-0008 要求 Built-in 在锁文件中以 `source: "builtin"` 与 `builtin:<skill-name>` 标识。
- CLI 包没有任何 npm lifecycle hook 来在 CLI 升级/降级后同步全局 Built-in 副本及其 ESL 管理的适配输出。

用户现在无法 `esl install @builtin/esl-operator`，也无法在 CLI 升级后获得与 CLI 版本严格一致的 `esl-operator` 技能。旧的 `skills/esl/`（曾以 `@cnfox/esl` 存在）已在工作区删除，新目录 `skills/esl-operator/` 处于 untracked 状态，但 CLI 不会打包它。

## Solution

从用户视角：用户安装 ESL CLI 后，可以随时 `esl install @builtin/esl-operator`（项目级或 `--global`），安装从当前 CLI 包内的 Built-in Skill Package 读取，不访问 ESL Server、不要求登录或网络；安装后照常自动适配到已配置的 AI 工具目录。此后每次升级或降级 `@esl/cli`，已经显式安装过的全局 `@builtin/esl-operator` 副本及其 ESL 管理的适配输出由 CLI 的 npm lifecycle 自动同步到与当前 CLI 版本严格一致；项目级副本不自动更新，由用户在该项目中显式 `esl update`。

CLI 构建时从 `skills/esl-operator/` 生成 Built-in Skill Package，并把它的 `skill.json` 版本钉为当前 `@esl/cli` 的完整 SemVer（含 prerelease）。安装身份、锁文件标识与适配目录/展示名遵循 ADR-0009 的 Scope 拆分：`builtin` 是保留 Scope，安装目录用 `builtin_esl-operator`（scope-qualified，与 published package 同构），适配后的 `SKILL.md.name` 用 `builtin:esl-operator`。

## User Stories

1. As a Skill User, I want to install the `esl-operator` skill into my current project, so that I can operate ESL through natural language without manually writing `esl` commands.
2. As a Skill User, I want to install the `esl-operator` skill globally, so that it is available in every project I work in.
3. As a Skill User, I want `esl install @builtin/esl-operator` to succeed without logging in, so that a fresh CLI can bootstrap the operator skill offline.
4. As a Skill User, I want `esl install @builtin/esl-operator` to succeed without network access, so that I can install the built-in skill in air-gapped or offline environments.
5. As a Skill User, I want the built-in skill to be read from the current CLI package, so that what I install is exactly the content shipped with the CLI version I am running.
6. As a Skill User, I want the built-in install to be recorded in `.skills.json` and `.skills-lock.json`, so that the installed skill is tracked like any other skill.
7. As a Skill User, I want the built-in install's lock entry to identify its source as `builtin`, so that `esl list` and tooling can distinguish it from registry and local skills.
8. As a Skill User, I want the built-in install's lock entry to use the identity `@builtin/esl-operator`, so that the skill's identity follows the same `@scope/skill-name` form as other skills.
9. As a Skill User, I want the built-in skill to be adapted into my configured AI tool directories automatically after install, so that Claude/Trae/Codex can see it without a separate step.
10. As a Skill User, I want the adapted built-in skill to use directory name `builtin_esl-operator`, so that the scope boundary is unambiguous in a single tool-scanned directory level.
11. As a Skill User, I want the adapted built-in skill's `SKILL.md.name` to be rewritten to `builtin:esl-operator`, so that AI tools can distinguish it from skills with the same short name.
12. As a Skill User, I want `esl list` to show the built-in skill with source `builtin`, so that I can see where the operator skill came from.
13. As a Skill User, I want `esl use @builtin/esl-operator` to print the built-in skill prompt without installing, so that I can preview it before installing.
14. As a Skill User, I want `esl info @builtin/esl-operator` to show the built-in skill's metadata, so that I can confirm its version matches my CLI.
15. As a Skill User, I want installing `@builtin/esl-operator` to never contact the ESL Server, so that no token, server config, or login is required.
16. As a Skill User, I want the built-in `skill.json` version to exactly equal the current `@esl/cli` version including prerelease, so that I always know the operator skill matches the CLI that shipped it.
17. As a Skill User, I want the built-in package to carry a content checksum, so that corruption during install can be detected.
18. As a Skill User, I want `esl update @builtin/esl-operator` in a project to refresh the project-level built-in copy from the current CLI package, so that a CLI upgrade can be followed by an explicit project refresh.
19. As a Skill User, I want `esl update` with no argument to also update an installed project-level built-in skill, so that built-in skills participate in the normal update flow.
20. As a Skill User, I want `esl update --global` to refresh the global built-in copy to the current CLI version, so that the global operator skill can be manually synced even if lifecycle auto-sync was skipped.
21. As a Skill User, I want the CLI upgrade lifecycle to automatically sync the already-installed global `@builtin/esl-operator` copy, so that the global operator skill stays in lockstep with the CLI.
22. As a Skill User, I want the CLI downgrade lifecycle to also sync the global built-in copy down to the older CLI version, so that a downgrade does not leave a mismatched operator skill.
23. As a Skill User, I want the automatic global sync to only touch the global copy I explicitly installed, so that the lifecycle does not silently install the built-in skill for users who never asked for it.
24. As a Skill User, I want the automatic global sync to only modify ESL-managed global install records and Adapt Manifest outputs, so that it never touches unrelated files.
25. As a Skill User, I want a failed automatic sync not to block the CLI install, so that a transient error cannot prevent the npm package from being installed.
26. As a Skill User, I want a failed automatic sync to be retried on the next CLI execution, so that a transient failure self-heals without manual intervention.
27. As a Skill User, I want project-level built-in copies to NOT auto-sync on CLI upgrade, so that projects remain reproducible until I explicitly update them.
28. As a Skill User, I want `esl uninstall @builtin/esl-operator` to remove the built-in skill, its dependency entry, lock entry, and adapted outputs, so that I can undo a built-in install.
29. As a Skill User, I want `esl adapt` to include an installed built-in skill, so that re-adapting after tool config changes refreshes the operator skill too.
30. As a Skill User, I want `esl adapt --prune` to respect the built-in skill's Adapt Manifest outputs, so that a removed built-in skill's adapted copies are cleaned.
31. As a Skill User, I want a CLI built-in skill to be rejected by `publish`, `upload`, `source`, `rename`, and `version` with a clear message, so that I cannot accidentally treat it as a server-hosted or authorable skill.
32. As a Skill User, I want `esl search` to never return the built-in skill, so that the operator skill is not conflated with server-hosted skills.
33. As a Skill User, I want installing `@builtin/<something-else>` to be rejected as unknown when no such built-in exists, so that only the actual built-in identities are installable.
34. As an ESL Platform Administrator, I want the built-in skill to have no Skill ID, Git repository, Skill Release, or Published Skill Package, so that the server-hosted lifecycle is not polluted by client-coupled skills.
35. As an ESL CLI maintainer, I want the build step to generate the Built-in Skill Package from `skills/esl-operator/`, so that the shipped CLI package always contains the operator skill.
36. As an ESL CLI maintainer, I want the build step to fail if the generated built-in `skill.json` version does not exactly equal the `@esl/cli` version, so that a mismatched package can never be shipped.
37. As an ESL CLI maintainer, I want the built-in package and its checksum to be validated before npm publish, so that the published npm package is internally consistent.
38. As an ESL CLI maintainer, I want the built-in skill source to remain the single editable copy in `skills/esl-operator/`, so that there is no drift between source and packaged artifact.
39. As an ESL CLI maintainer, I want the npm package to include the built-in skill resources, so that installed users can read them from the current CLI package.
40. As an ESL CLI maintainer, I want the npm lifecycle hooks to be registered in the CLI package manifest, so that global built-in sync runs on install/upgrade/downgrade.

## Implementation Decisions

- **架构边界**：Built-in Skill 实现严格限制在 CLI 侧与发行侧，不触碰 ESL Server、Core 的 Server-hosted 生命周期或 Git Backend。`packages/server` 不参与；`packages/core` 只扩展锁文件 schema 与 `listSkills` 来源枚举，以及新增 Built-in Package 的读取/校验函数（可复用现有 `validateSkillDirectory`、`copySkillDirectory`、`parseSkillName`、adapt 引擎）。
- **身份与 Scope**：Built-in Skill 使用保留 Scope `builtin`（ADR-0009）。安装身份为 `@builtin/esl-operator`；物理安装目录用 scope-qualified 的 `builtin_esl-operator`（与 Published Skill Package 的 `scope_skill-name` 布局同构，复用现有 adapt 目录规则）；适配后 `SKILL.md.name` 改写为 `builtin:esl-operator`。不新建 `@builtin` 之外的 Scope 语义。
- **安装路由**：`executeInstall` 增加第三条分支：当 `nameOrPath` 解析为 `@builtin/<skill-name>` 且该身份存在于当前 CLI 包的内置包清单时，走 Built-in 安装路径；否则对未知 `@builtin/*` 身份报"未知内置技能"。该分支在任何服务器/登录逻辑之前短路——不读取 token、不要求配置 server、不发起任何网络请求。该路径不要求登录（ADR-0008：安装从当前 CLI 包读取）。
- **Built-in 包读取**：运行时从当前 CLI 包解析 Built-in Skill Package 内容，采用与 `readCliVersion` 相同的「相对 `import.meta.url` 解析模块目录」模式，找到随 npm 包发布的 built-in 资源目录。资源目录里是构建期生成的包：`SKILL.md`、支持文件（`references/` 等）、`skill.json`、以及内容校验元数据。安装时复制该目录到目标位置，按项目/全局复用现有 `projectSkillsDir` / 全局 skills dir 布局（scope-qualified 目录）。
- **构建期打包**：`@esl/cli` 的 `build` 扩展为 `tsc` + 打包步骤：读取 `skills/esl-operator/`，生成 `skill.json`（name=`@builtin/esl-operator`、version=当前 `@esl/cli` 完整 SemVer 含 prerelease、description/author 等元数据）、计算内容校验值、产出 Built-in Skill Package 到 CLI 的 dist 资源目录。构建必须校验生成包内 `skill.json` 版本与 CLI 版本严格相等，不等则构建失败。npm publish 前校验内置包内容、版本一致性、checksum 与 npm 包包含性（ADR-0008 硬约束）。
- **锁文件 schema**：`SkillsLockEntry` 增加 `source` 字段（`registry | local | builtin`），Built-in 安装写入 `source: "builtin"`；`resolved` 记录到内置包来源的标识（如 `builtin:<skill-name>` 或指向 CLI 内置资源的稳定标识），`integrity` 记录内容校验值。`listSkills` 的 `source` 枚举增加 `builtin`，按 `source` 字段（无则按现有 `resolved.startsWith('file:')` 推断）决定显示来源。`.skills.json` 的依赖条目保留 `@builtin/esl-operator` 身份。
- **adapt 参与**：Built-in 安装后进入 `.skills/`（或全局 skills 目录）后，走现有 `scanSkillsDir` / `adaptSkillsToTools` 流程，复用现成的 adapt 引擎；无需新 adapt seam。Adapt Manifest 照常记录 built-in 的 `tool` / `identity` / `directoryName` / `displayName` / `targetDir`。
- **npm lifecycle 自动同步**：在 CLI 包 manifest 注册 install/upgrade/downgrade 生命周期 hook（如 `postinstall` 及配套），仅当用户已显式安装过全局 `@builtin/esl-operator` 时才同步：重写全局副本 + 刷新其 Adapt Manifest 输出 + 更新锁文件到当前 CLI 版本。同步失败不阻断 npm 安装，剩余同步任务记录并延迟到下一次 CLI 执行时重试。只修改 ESL 管理的全局安装记录与 Adapt Manifest 输出；不自动首次安装；不触碰项目级副本。
- **update 行为**：`esl update @builtin/esl-operator`（项目级）把项目副本刷新为当前 CLI 包版本；`esl update --global` 刷新全局副本；无参数 `esl update` 覆盖已安装的 project 级 built-in。项目级不随 CLI 升级自动同步。
- **命令禁集**：`publish`、`upload`、`source`、`rename`、`version` 对 `@builtin/*` 身份显式拒绝并给出"内置技能不可作为 Server-hosted 技能发布/上传/拉源码/改名/改版本"的明确信息；`search` 不返回任何 `@builtin/*`。
- **支持的命令**：`use`、`info`、`list` 支持 `@builtin/*`（从 CLI 包读元数据/内容，不联网、不登录）；`install`、`update`、`uninstall`、`adapt` 对 built-in 与普通技能走同一套本地状态管理，仅来源与版本锁定不同。
- **Out-of-repo 的 `skills/esl-operator/` 迁移**：`skills/esl-operator/` 是 built-in 的唯一可编辑源码（ADR-0008），保持于仓库根，不并入 `packages/cli/src`；构建从该目录读取并生成产物。旧 `skills/esl/`（`@cnfox/esl`）从仓库删除，不再以 Server-hosted 技能存在。

## Testing Decisions

- **好的测试标准**：只测外部可观察行为——安装后 `.skills/` 目录布局与内容、`.skills.json` / `.skills-lock.json` 的内容、`esl list` 输出、adapt 后工具目录文件与 `SKILL.md.name` 改写、命令拒绝信息、npm lifecycle 触发后的全局副本状态。不测私有 helper 结构。Built-in 安装测试不得依赖真实 ESL Server 或登录。
- **Seam 1（运行时安装/更新/卸载/adapt，主 seam）**：直接调用 `executeInstall('@builtin/esl-operator', { homeDir })` 及 `executeUpdate` / `executeUninstall` / adapt 相关公开函数，注入 temp home / temp project 与指向 fixture 内置包源目录的解析器。Prior art：`packages/cli/tests/install.test.ts`、`install-project.test.ts`、`list.test.ts`、`uninstall.test.ts`、`adapt.test.ts` 已用同一模式（temp dir + 注入依赖）。
- **Seam 2（构建期打包）**：对 fixture 技能目录运行打包脚本，断言产出 `skill.json` 的版本等于注入的 CLI 版本（含 prerelease）、files 清单完整、校验值正确；断言版本不一致时构建失败。Prior art：`packages/cli/tests/version-command.test.ts`（版本解析）、`validate.test.ts`（包校验）。
- **Seam 3（锁文件 schema）**：并入 Seam 1——安装后断言 `.skills-lock.json` 条目的 `source: "builtin"` 与 `identity: "@builtin/esl-operator"`；`esl list --json` 断言 source 为 `builtin`。Prior art：`list.test.ts` 的锁文件与 JSON 输出断言。
- **Seam 4（npm lifecycle 同步）**：直接调用 lifecycle 同步函数（模拟 npm 触发），断言：已显式安装全局 built-in 时副本与 Adapt Manifest 被刷新到当前 CLI 版本；未显式安装时不变；同步失败返回可重试状态且不影响"安装成功"结论。Prior art：`install.test.ts` 的全局 install 断言、`adapt.test.ts` 的 manifest 断言。
- **命令禁集测试**：`publish` / `upload` / `source` / `rename` / `version` 对 `@builtin/*` 拒绝的 CLI 行为测试；`search` 不含 built-in。Prior art：`publish.test.ts`、`source.test.ts`、`upload.test.ts`、`commands.test.ts` 的拒绝/错误断言。
- **完整验证**：`npm test` 与 `npm run build` 通过。

## Out of Scope

- 创建任何新的 `@builtin/*` 技能——当前只有 `esl-operator` 是 Client-coupled Built-in Skill（ADR-0008）；本 spec 只实现 `@builtin/esl-operator` 的打包、安装与同步管线。
- Server-hosted Skill、Skill ID、Git 仓库、Skill Release、Published Skill Package 的任何改动——built-in 严格排除在服务器生命周期之外。
- `@builtin/*` 的 `search` / Registry API 可见性——built-in 永不进入服务器搜索结果。
- 除「全局副本随 CLI 升降级自动同步 + 项目级显式 update」之外的任何自动安装/同步策略。
- 内置技能的可编辑能力——`skills/esl-operator/` 只随 CLI 发行更新，不可 `upload` / `publish` / `source` / `rename` / `version`。
- 任何需要 Server 或登录参与的行为（built-in 全程离线）。
- 移除 `@builtin/esl-operator` 之外的任何既有技能的 install/update 行为。

## Further Notes

- 本 spec 是 ADR-0008 的落地实现；术语遵循 ADR-0009 的 Scope 拆分（`builtin` 是保留 Scope，非 Namespace）。`skills/esl-operator/` 已按新术语同步（SKILL.md 规则 3 含 `@builtin/<skill-name>`、consumer/author references 用 `@scope/skill-name`）。
- `@builtin/esl-operator` 的 adapt 目录名 `builtin_esl-operator` 与展示名 `builtin:esl-operator` 由 ADR-0009 的 scope-qualified 规则自然推出，不需要新的 adapt 规则。
- 现有 `executeInstall` 的 `installFromServer` 强制 `requireFreshToken`，built-in 分支必须在任何登录/server 逻辑之前短路，否则离线安装会被登录检查挡住。
- 旧的 `skills/esl/`（`@cnfox/esl`）已从仓库删除；`skills/esl-workspace/iteration-1/*/with_skill/outputs/transcript.md` 仍引用 `skills/esl/SKILL.md` 旧路径，属于历史 eval 存档，不在本 spec 范围，但后续可清理。
- npm lifecycle 自动同步只发生在 CLI 升级/降级后的下一次 CLI 执行（ADR-0008），项目级副本始终由用户显式 `update`，保证项目可复现。