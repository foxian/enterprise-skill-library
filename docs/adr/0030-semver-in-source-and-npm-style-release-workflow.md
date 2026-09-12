# SemVer 进源码，发布链采用 npm 式版本工作流

Status: accepted

ESL 此前的模型是「源码无版本」：SemVer 只作为 `esl publish` 的显式位置参数（`.scratch/server-hosted-skill-lifecycle` spec 明确规定 "Source files and the Release Manifest do not carry the Skill Release version"），`release.json` 不含版本，「最新版」按插入序取 `releases[0]`，`esl version` 对源码格式技能直接拒绝。我们对照 npm 的 `init` / `version` / `publish` 逐项评估后，认为 npm 的版本管理模型更合理——版本随源码走 Git 历史，发布读取源码版本，发布者与版本变更点在本地一次绑定——决定推翻「源码无版本」约束，把 SemVer 移入 Release Manifest，并以此重构版本命令、发布流程与版本解析规则。

具体决策如下：

- **`release.json` 增加 `version` 必填字段**，schema 升到 `schemaVersion: 2`；`SKILL.md` 仍不携带版本（身份/内容描述与发布属性分置两个清单，延续 ADR-0010 的职责二分）。SemVer 校验统一拒绝 build metadata（收掉 `skill-json.ts` 的 `SemVerSchema` 与 CLI 位置参数正则的不一致）。旧 `schemaVersion: 1` 清单通过 `esl version <显式 SemVer>` 一次性迁移，不做双轨兼容。
- **`esl version` 重定义为源码格式专用的 bump 命令**（npm 式）：接受 `major|minor|patch` 或显式 SemVer，改写 `release.json` + git commit + 本地 annotated tag `v<SemVer>`，不 push（push 归 upload/publish）。`version` 字段缺失时 bump 关键字报错并指路显式设值完成迁移初始化。旧 skill.json bump 路径删除——`skill.json` 按 ADR-0010 只存在于安装副本与 Published Skill Package，在生成物上做 bump 语义本就不成立。
- **`esl publish` 移除版本位置参数**（传了报错指路 `esl version`），版本从发布 commit 的 `release.json` 读取；且**对已托管源自动完成源码同步**（复用 upload 的 fetch/rebase/push 机器）后再发布，upload 保留为纯源码协作入口。**首次登记仍由 `esl upload` 承担**：缺 `esl` remote 时 publish 不隐式建仓、不注册 Skill ID、不推断身份，而是报错指路先执行 `esl upload`（延续 ADR-0010 与 ADR-0021 对隐式创建与接管的拒绝）。服务端校验 `v<SemVer>` tag 存在且指向 HEAD，现有 `tagPending` / `repair-tag` 机制降级为兜底。重复版本仍 409 拒绝。
- **版本解析从插入序改为「最高稳定 SemVer、排除 prerelease」**，覆盖 CLI `install` / `update` / `use`（原 `info.versions[0]`）、服务端 `packageUrl` 与管理后台 `latestRelease`（原 `releases[0]`）、依赖锁定（改为满足 range 的最高版）。prerelease 版本仅显式 `--version` 可装。本地路径安装读 `release.json.version`（原硬编码 `0.1.0`）。
- **单调性不做服务端校验**（保留 1.x 补丁回迁的正当场景），CLI 在 publish 时发现版本低于服务器最高已发布版则警告并要求确认（`--force` 跳过），拦截手滑烧号。
- **新增 `esl deprecate <skill-name> <version> --message`**（借 npm deprecate）：安装与解析命中该版本时打印警告，不阻止安装、不影响 latest 推导；空 message 解除。它补上「不可变 + 单版本不可删」模型下坏版本只能沉默存在的洞，是不可变发布的配套手段。
- **新增 `esl publish --dry-run`**：本地全量校验 + 待发布内容预览（版本、commit、文件清单），不碰服务端。ESL 发布不可变且不可覆盖，预演价值高于 npm。
- **新增单版本删除**：删除单个 Skill Release 的四件套（包文件、release 记录、version 条目、`v<SemVer>` tag），保留源码 Git 历史、技能本身与其余版本。**技能 Maintainer** 即可执行，前提是无其他技能的 Release Dependency Lock 引用该版本且显式确认；被引用的版本仅 ESL Platform Administrator 可强制删除（依赖检查降为强警示）。被删版本号视为烧毁、不得重发。这是 ADR-0014「破坏性操作归管理员」哲学在版本粒度的细化：整技能删除（摧毁身份）归平台管理员，版本级外科手术在有依赖护栏时归 Maintainer，护栏即权限边界。
- **`esl init`** scaffold 的 `release.json` 直接带 `version: "0.1.0"`（技能初版用 1.0.0 语义过强）；TTY 环境下逐项问答（name/description/license/keywords，各带默认值），`--no-input` 或管道环境回落固定模板——交互式与非交互式两种形态都保留。
- **明确不借鉴**：dist-tag 通道（`latest`/`next`，latest 改由 SemVer 推导，无通道状态可管理、也不会忘记切换）；npm 式 72 小时维护者自助 unpublish（Release Dependency Lock 钉着 checksum，自助删除风险过高，管理员把关替代时窗模型）；provenance/OTP 等 registry 特性（当前无需求）。

## Consequences

- 推翻 `.scratch/server-hosted-skill-lifecycle` spec 的「SemVer 只作 publish 参数」约束；CONTEXT 的 Release Manifest 词条改为记录 SemVer，Release Tag 词条的创建者由 publish 改为 `esl version`。
- `skill_versions` / `skill_releases` 的插入序「latest」语义失效：`getReleases` / `getVersions` 的消费方、`esl info` 版本排序、`packages/server/tests/app.test.ts` 的版本顺序断言、`docs/guides/skill-release-lifecycle.md` 依赖插入序的示例均需随之更新。
- `skill_releases` 增加 deprecated 标记与劝退说明；新增单版本删除端点、依赖锁定引用检查（扫描全量 `dependency_lock_json`）与审计记录。
- `esl version` 现有「拒绝源码格式、指向 publish 参数」的报错路径整体移除；`packages/core` 的 `bumpSkillVersion` 让位于 release.json 版本的 bump 逻辑。bump 在仓库存在未提交改动时拒绝执行——否则会把作者未完成的改动一并卷进版本 commit。
- 单版本删除**必须保留 tombstone**（删除记录或独立的烧毁版本表）：只删 `skill_releases` 行会让服务端「重复版本 409」检查一并失效，同号重发被放行，与本节「被删版本号不得重发」的承诺相矛盾。
- upload 与 publish 的分工从「publish 要求先 upload」调整为「首次登记仍是 upload，此后 publish 自含同步」：ADR-0010 中「publish 不自动 upload」中关于**已托管源**的部分被本 ADR 取代（忘记 push 不再阻断发布），而「不隐式建仓、不隐式推断身份」的部分继续有效并前置到「缺 `esl` remote 即报错」。
