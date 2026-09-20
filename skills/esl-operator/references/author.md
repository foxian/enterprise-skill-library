# 作者工作流：建 / 校验 / 发布 / 升版 / 拉源码

只读命令（直接跑）：`validate`。
写命令（先回显、确认再跑）：`init` `version` `source` `reset-source` `upload` `publish` `deprecate` `release-delete` `share`。

## 初始化新技能（就地补缺）
`esl init [./path] [--name <短名>] [--namespace <namespace>] [--license SPDX] [--description <text>] [--keywords a,b] --agent-interaction --agent-tool <tool>` —— 把指定目录（默认当前目录，可用全局 `-C` 选定）就地初始化为技能源：**缺什么补什么，绝不覆盖已有文件**。没有 `SKILL.md` 则生成（frontmatter 只含短名与描述）；没有 `release.json` 则补最小清单（`schemaVersion: 3`、`name`、`version: 0.1.0`，`license` 默认 `MIT`）。**不生成 `skill.json`**——它是安装/发布包的生成物，不属于源码。本技能由 AI 执行，`--agent-interaction --agent-tool <tool>` 是固定组成，不等待终端输入；`<tool>` 按当前宿主传（Claude Code 用 `claude-code`，兼容旧值 `claude`）。

短名权威顺序：已有 `SKILL.md.name` > `--name` > 目录 basename。已有 `SKILL.md` 时整个文件不动；frontmatter 只要包含合法的 `name` 和 `description` 即可，`metadata`、`allowed-tools` 等额外键会被接受并忽略。缺少必填字段或类型非法时，`init` 只补缺并打一行警告，严格校验交给 `esl validate`。目录已是 git 仓库（含父级）时跳过 `git init`。

在终端里 `init` 会逐项询问仍缺失字段的 description、license、keywords、namespace（各带默认值，回车接受）。namespace 会优先显示编号列表（1 固定为 personal，其余是当前登录用户所在组织；登录态有效时向服务端取一次组织列表，失败则回退登录时缓存，无列表退回手输），非交互环境（管道、`--no-input`）跳过问答直接写模板。已经用旗标给出的字段不会再问，所以 `--license Apache-2.0` 仍会问 keywords、但已生成 SKILL.md 时不再问 description。**脚本化场景建议把四个字段都用旗标给全**，避免依赖问答。

AI Agent 必须运行 `esl init ./my-skill --agent-interaction --agent-tool <tool>`，
让缺失输入以 JSON 返回（退出码 `2`）；向用户收集后重跑同一命令。Claude Code、
Codex、Trae 国际版和 Trae 国内版分别传 `claude-code`、`codex`、`trae-intl`、
`trae-cn`；旧值 `claude` 仍兼容。stdout 直接给出 `AskUserQuestion` 风格 JSON（含 `questions` 数组，
`metadata.source` 为 `esl-cli`），按宿主的交互界面消费。不带
`--agent-tool` 时输出同一格式。简单字段优先用专用旗标，多个结构化字段可用
一次 `--params-json`：

```bash
esl init ./my-skill --agent-interaction --agent-tool claude-code --params-json '{"description":"代码审查技能","license":"MIT","keywords":["git","review"],"namespace":"personal"}'
```

`--params-json` 只接受顶层 JSON object，未知字段、错误类型，或同一字段同时由
专用旗标和 JSON 传入都会按普通参数错误失败。

注意：`init` 的 `--name` 只接受**短名**；`--namespace` 接受 `personal`（默认）或组织名。归属写在 `release.json` 的 `name` 字段（v3，ADR-0032）：个人归属写裸短名（如 `my-skill`，上传时按上传者解析个人命名空间）；组织归属写 `@组织名/短名`。想发布到组织命名空间，用 `esl init --namespace <组织名>` 或把 `name` 改成 `@组织名/短名`——但**首次 `upload` 即固定身份**，之后改归属必须走正式流程，别指望靠改 `name` 迁移。

## 选目录：全局 -C
`esl -C <dir> <命令>`（长写 `--cd <dir>`）—— 借鉴 npm：先把工作目录切到 `<dir>` 再执行命令，对所有命令生效，位置可写在子命令前或后。相对 `-C` 的路径按**切换前**的 cwd 解析；切进去之后所有位置路径参数按**切换后**的 cwd 解析，想覆盖 `-C` 的目录请给绝对路径。给目录类命令传技能目录的写法就两条：全局 `-C` 或命令自带的位置路径（`esl upload [./path]`）；各命令的 `--directory` 选项已移除。

## 校验
`esl validate ./path` —— 发布前检查目录结构与 `SKILL.md` frontmatter。frontmatter 要求合法且必填的 `name`、`description`；其他额外字段允许存在，但不参与 ESL 元数据。源码形态下，发布输入是 `SKILL.md` + `release.json`；`skill.json` 不在源码里，`validate` 不要求它。只读。校验失败把错误逐条对照修，别带 `--force` 跳过。

注意：`validate` 只校验结构，**不拦 `@local/*` 保留 Scope**——`@local` 的发布拦截由 `publish` 阶段执行。所以你在提议 `publish` 前要自己复核技能身份不是 `@local/*`，别等 `validate` 通过就以为能发。

## 上传源码（发布前必需）
`esl upload [./path] [--license SPDX] [--confirm-identity <技能名>]` —— 把本地源码目录首次创建为 Server-hosted Skill Source：生成 Skill ID 与服务器 Git 仓库，并把本地源码推上服务器（加 `esl` remote）。技能目录用位置路径（`esl upload ./markdown-master`，默认当前目录）或全局 `-C` 指定。发布前必须已有 `esl` remote 且 `HEAD` 已推上去。新技能从 `init` 之后，先 `upload` 再 `publish`。

- **技能描述随每次 upload 同步**：`upload` 始终以 `SKILL.md` frontmatter 的 description 为准，把技能描述登记/更新到服务器（首次注册随登记写入；已托管源的后续同步走独立的仅 Maintainer 可用的 description 更新）。描述更新失败不阻断源码同步，仅在输出中提示——看到提示可如实转述，不要重试整个 upload。管理后台的技能管理页面展示的就是这个「最近一次 upload 登记的描述」，改了 `SKILL.md` 的描述后要跑一次 `upload` 才会在线上生效。

- **归属由 `release.json` 的 `name` 决定**（ADR-0032）：`@组织名/短名` 要求上传者是该组织成员（任何成员都可直发新技能，上传者成为初始 Maintainer，无需组织管理员预授权）；裸短名或 `@自己的用户名/短名` 落在个人命名空间。身份在**首次 upload 时固定**，之后 `publish` 只会断言 `name` 与既定身份一致——不一致直接报错，归属变更不得借发布顺车。
- **首次 upload 先确认身份**（ADR-0039）：交互式终端会显示将要创建的完整技能身份并要求 `y/N` 确认；非交互模式必须传 `--confirm-identity <release.json.name>`，值要和清单里的 `name` 完全一致。确认错了就改 `release.json` 后再上传，别把错误归属注册成新源。
- **已托管源禁止跨 namespace 漂移**（ADR-0039）：后续 `upload` 会在 fetch/rebase/push 前比对 `release.json` 声明的 namespace 与 `esl` remote 揭示的既有 namespace；不一致直接阻断。恢复 `release.json` 的原 namespace 后继续同步；确需其他归属，只能显式创建新源，不支持跨 namespace 迁移。
- 若目录缺 `release.json`，`upload` 会自动补最小清单（`schemaVersion: 3`、裸短名、`version: 0.1.0`、`license` 默认 `MIT`，可用 `--license` 覆盖），并落盘到源码目录，然后提示先 commit + push、再重跑 `upload`。
- **Server Origin 迁移自动重指**：ESL Server 换地址（数据整体迁移，如换域名/IP）后，已托管目录的 `esl` remote 仍指向旧地址；下次 `esl upload` 会检测到 origin 漂移，自动向当前服务器验证技能身份（含改名重定向）后把 remote 重指到新地址并继续上传，输出一行「re-homed the esl remote」提示——不需要手动 `git remote set-url`。若验证不过（技能在当前服务器不存在，或当前登录读不到），报错会区分「地址迁移未验证」与「账号/权限」，并给出与下条相同的两条出路。
- 已托管目录（有 `esl` remote）上 fetch 失败时，`upload` 先用 Registry API 做一次只读探测再报错（ADR-0027），按探测结果分三种文案：**① 技能身份在服务器可见但 Git 源同步不了**——凭据陈旧或缺仓库权限，提示用维护它的账号重新登录后再 `esl upload`；**② 身份可见但服务器 cloneUrl 与 remote 仓库路径不一致**——remote 指向陈旧路径（如改名后），提示核对后手动 `git remote remove esl` 再重新 `esl upload`；**③ 探测失败（不确定）**——降级为统一的两种可能文案（其他账号维护 或 源已不存在），出路上「切维护账号重登」或确认删除后手动 `git remote remove esl` 两步重建。push 失败走同一统一文案并附 `git push esl HEAD:main` 收尾提示。CLI 绝不自动删除 remote 重注册——看到这类报错别提议删 remote，先按文案里的探测结论引导：能确定「身份可见」就只查账号/权限，探测失败才让用户去确认服务器源是否还在。

## 发布
`esl publish [./path] [--message <text>] [--dry-run] [--force|-f] [--license SPDX]` —— 在技能目录内执行，把当前源码发布为 Skill Release。**版本号不是命令参数**：它取自被发布 commit 的 `release.json.version`，所以发新版前必须先 `esl version`（见下节）。要求目录含 `release.json`；若缺失会自动补最小清单（`schemaVersion: 3`、裸短名、`version: 0.1.0`、`license` 默认 `MIT`），落盘后**提示先 `esl version` 设定版本、再发布**（不会继续发布）。默认会先要你确认；`--force` 跳过确认；`--no-input` 在自动化里失败即止。

- **传版本号会被拒绝**：`esl publish 1.0.0` 不再兼容（会被识别为误传的版本参数并报错指路 `esl version`）。要发 1.0.0 就先 `esl version 1.0.0`（或 `esl version major`）。
- **自动同步源码**：对已托管源，`publish` 会 `fetch`、必要时 rebase 到 `esl/main`、并 push 本地领先的提交与 tag——忘记 push 不再阻断发布；rebase 冲突时保留现场，提示解决后重跑。
- **发布前校验 release tag**：`v<SemVer>` 必须存在且指向被发布的 commit；缺失或指向别处会报错并指路 `esl version`。
- **回迁守卫**：新版本低于服务器最高已发布版本时会被拒绝（防手滑烧号）；确需回迁旧线时用 `--force` 越过。
- **`--dry-run` 预演**：跑完所有本地校验（源码合法、工作树干净、remote 与身份、tag 指针）并打印将要发布的内容（版本、commit、文件清单），**不接触服务端、不 push**。用户想先看清楚会发什么时用它。
- 若目录还没有 `esl` remote，`publish` 会报错并提示你先 `esl upload`；它不自动建仓、不隐式登记，也不替你推断发布身份。

重要：`@local/*` 保留 Scope 被系统拦截、无法发布（保留名同理：`local`/`builtin`/`admin`/`api`/`git`/`system` 不能作 scope 或用户名）。**发布身份以 `release.json` 的 `name` 为准**（ADR-0032），`publish` 只断言它与首次 upload 固定的身份一致。跑完报告服务器返回的技能身份与 Release Tag（`v<SemVer>`）提示。

## 升级版本号
源码形态（`SKILL.md` + `release.json`）的版本号**存在 `release.json` 的 `version` 字段里**，随源码走 Git 历史。升版一律走 `esl version`：

- 裸 `esl version` —— 仅在交互式终端中显示选择器，列出 `patch`、`minor`、`major` 的实际目标版本和用途，也可输入自定义 SemVer。
- `esl version patch|minor|major` —— 按 SemVer 递增，改写 `release.json`、自动 commit、并创建 annotated tag `v<SemVer>`。
- `esl version <显式 SemVer>`（如 `esl version 1.4.2`）—— 直接设值；这也是旧 `schemaVersion: 1` 清单的迁移入口（用递增关键字会报错指路）。
- 非 TTY 或 `--no-input` 下不能省略版本参数；AI Agent 执行裸命令时使用 `--agent-interaction`，按返回的 `Release type` 问题收集答案，再用 `--params-json '{"release":"patch"}'` 重执行。
- **`esl version` 不 push**：推送归 `esl upload` 或下一次 `esl publish`（`publish` 会自动同步）。
- 工作树有未提交改动时拒绝执行——先提交或 stash，避免无关改动被卷进版本提交。
- 内置技能（`@builtin/*`）不可升版，其版本锁定在 ESL CLI 版本上。

标准发版序列：改源码 → `git commit` → `esl version patch` → `esl publish`（必要时先 `esl publish --dry-run` 预演）。

## 弃用与删除单个版本
坏版本（安全缺陷、内容错误）发出后不可覆盖、不可重发同号，只能劝退或删除：

- `esl deprecate @ns/name <version> --message "说明"` —— 标记为不推荐。安装该版本的人会看到这段说明，但**仍可安装**；弃用不改变版本解析（被弃用版本若仍是最高稳定版，默认安装依旧选中它）。传空 message 解除标记。需要技能管理权。
- `esl release-delete @ns/name <version> --confirm <version>` —— 删除单个 Release，用于内容必须从服务器消失的场景（如误发密钥）。移除该版本的发布包、版本记录与 Release Tag，**保留源码 Git 历史、技能本身与其他版本**。必须用 `--confirm` 回显版本号（版本号烧毁、不可重发，所以要显式确认，别替用户省这一步）。
  - 技能 Maintainer 可删自己技能的版本；若该版本被其他技能的 Release Dependency Lock 引用，服务端会拒绝并列出引用方，此时只有平台管理员能加 `--force` 强制删除（强制后相关技能的安装会因依赖缺失而失败——报错里会说明，别默认加 `--force`）。
  - 想「劝退但不删除」用 `deprecate`；`release-delete` 只在内容必须消失时用。

## 拉别人源码做二次开发
`esl source @ns/name [./dir]` —— 克隆远端 Git 源码到本地（默认当前目录），可改可修。这拿的是源码仓库，不是 Published Package。

## 重置源链接（源已在服务器删除后重建）
`esl reset-source [./path] [-f]` —— 把一个已托管目录（有 `esl` remote）还原为未托管的本地源：删除 `esl` remote 并把 `release.json` 改名保留为 `release.json.before-reset`。**它只做本地脱管，绝不删服务器上任何东西，也不自动重新登记**——重传始终是下一条显式的 `esl upload`（将生成全新 Skill ID）。适用场景只有一个：确认服务器源已被删除、本地要按新源重建。执行前的守门：CLI 先向 Registry API 询问一次该身份是否还存在——**身份仍可见时直接拒绝执行**（服务器源还在，别拿它当删除手段；报错会给出两条正途：切维护账号重登后 `esl upload` 同步，或在 Web 技能生命周期页真正删除：未发布技能由 manage 权限持有者删除，已发布技能由平台管理员或组织所有者删除），只有 `--force` 能越过阻断；探测失败才对应「确实没删到」的场景静默通过。要求确认，非交互传 `--force`。重传后缺 `release.json` 会自动补最小清单，需要的字段可从 `.before-reset` 备份拷回。别在源只是「维护账号不对」时怂恿用户 `--force`——阻断报错就是在拦这种情况，先让用户去服务器核实。

## 共享与权限
`esl share @ns/skill-name --all [--write]` —— 授权给组织常设团队：`--all` 为组织只读团队（全员可读），`--write` 为组织读写团队。
`esl share @ns/skill-name --team <team>` —— 按技能授权指定团队只读；追加 `--write` 为读写，追加 `--manage` 为管理。团队成员会按该技能的授权档位获得权限。
`esl share @ns/skill-name --user <username> [--write]` —— 授权给单个成员只读或读写。
`esl share @ns/skill-name --reset` —— 重置为仅自己可见（撤销全部团队挂载与协作者授权）。
四个目标互斥，一次只能选一个；执行前按写命令规则先回显完整命令、等用户确认。只有技能 Owner 或组织管理员能改权限，403 时提示无权而非重试。
