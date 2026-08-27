# 发布链收敛到 Release Manifest，本地安装收敛到 Skill Manifest 并移除 import

Status: accepted

ESL 存在两套本地清单（`skill.json` 与 `release.json`）且历史命令对它们的边界含糊，导致同一 `publish` / `upload` 按目录里是否存在 `release.json` 走两条语义不同的分支（`packages/cli/src/commands/publish.ts:30`），`esl import` 又在源目录写入 `skill.json`（`packages/core/src/skill/import-skill.ts:62-79`），与「源码不保存 `skill.json`」（ADR-0007）矛盾。我们决定把两条链彻底收敛，消除该含糊：**发布链**只认 Release Manifest（`release.json`），**本地安装/适配链**只认 Skill Manifest（`skill.json`），两条链互不越界，源目录与源码不包含任何清单。

具体决策如下：

- **清单职责二分**：`release.json` 是发布链清单，只被 `upload` / `publish` 与服务器发布流程消费；`skill.json` 是本地/安装清单，只在两种生成物中存在——本地安装时的技能包副本，以及服务器发布时生成的 Published Skill Package（由服务器写入，`packages/server/src/routes/skills.ts:256-263`）。Server-hosted Skill Source 与 Local Skill Source 均不包含 `skill.json`，发布输入只有 `SKILL.md` 与 `release.json`。
- **发布链冻结包形态分支**：`publish` / `upload` 只接受源码形态（目录含 `release.json`），不再支持「本地 skill.json 包直接推成源码」的旧路径。两者在缺失 `release.json` 时都自动补最小清单（`schemaVersion: 1`，`license` 由用户显式确认——它无法推断，不设默认猜测；`keywords` / `compatibility` / `dependencies` 为空集合），落盘到源码目录，然后提示先 commit + push、再重跑命令，因为服务器发布时以源码 commit 的 `release.json` 为准（`skills.ts:210-216`），仅内存生成会被忽略。
- **`publish` 不自动 `upload`**：补全 `release.json` 后，若目录尚无 `esl` remote，`publish` 报清晰错误并提示先执行 `esl upload`。发布只发布当前已推送且等于 `esl/main` 的 `HEAD`（`publish.ts:104-107`），不隐式 push 源码、不自动建仓、不自动从登录用户推断身份（与 Local Namespace publish guard 一致）。
- **`init` 只生成源码骨架**：`esl init` 生成 `SKILL.md` 与 `release.json`，不再生成 `skill.json`。`release.json` 的 `license` 用常见默认（如 MIT）并允许 `--license` 覆盖，避免首次 `publish` 被交互式打断。
- **本地安装只认 Skill Manifest 且清单在副本生成**：`install` 统一负责把技能装进 `.skills`，其来源由参数自动判断——服务端身份来自 `@org/name`、内置身份固定 `@builtin/name`、本地路径一律 `@local/<name>`；三者的 namespace 均确定，因此 `install` **不提供 namespace 参数**，也不从登录用户推断身份。本地裸目录（只有 `SKILL.md`）安装时，`install` 在**安装副本**里补最小 `skill.json`，源目录不动。
- **移除 `esl import`**：`install` 的本地路径分支（`installFromLocalPath`，`packages/cli/src/commands/install.ts:61-93`）已内置隐式导入（校验失败自动补清单），且本地路径 namespace 定为 `@local` 后，`import` 相对于 `install` 不再有任何不可替代能力（其唯一的 `--namespace` 差异随之消失），故移除 `import` 命令及其 core 层的 `prepareSkillImport` 写源目录行为。

## Consequences

- `esl import` 命令与 `packages/cli/src/commands/import.ts`、`packages/core/src/skill/import-skill.ts` 的「写源目录 `skill.json`」职责移除；`import` 的导入语义并入 `install` 本地路径分支。
- `install` 本地路径分支不再依赖源目录有 `skill.json` 才通过校验，改为复制后于副本补最小清单；`validateSkillDirectory` 对**本地路径安装**的调用语义需要随之调整（安装前仍校验 `SKILL.md`，`skill.json` 在副本生成后校验）。
- `publish` / `upload` 删除包形态分支（`publish.ts:30-86` 中无 `release.json` 的路径、`upload.ts:36-78`），仅保留源码形态；`publish.ts:88` 的 `executeSourceRelease` 作为唯一发布路径。
- `init`（`packages/cli/src/commands/init.ts`）从写 `skill.json` 改为写 `SKILL.md` + `release.json`。
- `skill.json` 的本地读写入口（`install` 副本、`adapt`、`version`、`list`）保持不变，但其生产位置收窄为「安装副本 / Published Skill Package / Built-in Skill Package」。
- `docs/guides/skill-release-lifecycle.md` 的 walkthrough（当前 `git add skill.json SKILL.md` → `esl publish`）需更新为源码形态（`release.json` + `upload` → `publish`）。
- 术语与文档随 CONTEXT 的 Skill Manifest / Release Manifest 二分同步，消除「发布依赖 skill.json」的旧表述。
