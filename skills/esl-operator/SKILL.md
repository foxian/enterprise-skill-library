---
name: esl-operator
description: >
  Operate the Enterprise Skill Library (ESL) CLI from natural language. Search, try, install, list, update, uninstall, link shared skills into AI tools, or link a local skill source into the Skill Store (Claude Code, Codex, Cursor, Trae, WorkBuddy, opencode, OpenClaw, Hermes); inspect tool-link status through list and repair recorded links through update; create, validate, version, publish, or clone the source of skills. Use whenever the user wants to find or use a shared skill, install/update skills (project or global), inspect which tools have which skills, author or publish a skill, pull someone's skill source for edits, or otherwise drive the `esl` command — even when they never say "esl". Routes login and server setup but never types passwords.
---

# esl operator

ESL 是企业技能注册平台；`esl` 是它的 CLI。本技能让你（AI）听懂用户的自然语言意图后，在终端里真跑 `esl` 命令——Windows 的 PowerShell、macOS/Linux 的 bash 或 zsh 均可，不重新实现 CLI 逻辑，只做"意图 → 命令 → 分级执行"的翻译。用户说"搜个 code-review 技能""把我写的技能发出去"，你就知道跑哪条命令。


## 先做环境体检，再开始工作

不要一上来猜命令或直接执行安装/发布。先判断用户要完成的结果，再做一次**最小环境体检**；体检只读，可直接执行：

```text
1. `esl --version`       # CLI 是否已安装、当前版本
2. `node --version`      # Node.js 是否存在且受支持（20.17.x、22.x >=22.13、24.x）
3. `npm --version`       # 需要安装/升级 CLI 时是否可用
4. `esl account whoami`  # Server 配置和登录态；公开搜索/详情可按需继续
5. `git --version`       # 仅在源码 clone/upload、发布等 Git 流程需要时检查
```

按结果分流：

- `esl` 不存在：明确告诉用户“当前不能执行 ESL 操作”，先按 `references/setup.md` 安装 `@foxian/esl`；不要假装用 `npm` 代替 ESL 操作。
- `node` / `npm` 缺失或 Node 不在支持范围：先解决运行时，再安装 CLI。
- CLI 存在但 Server 未配置：向用户索取管理员提供的 ESL Server URL，再执行 `esl config set-server <url>`（这是写配置，先确认）。不要猜地址，也不要把仓库开发地址当成用户的企业地址。
- Server 可达但未登录：公共搜索和部分只读查询可继续；私有技能、安装、更新、上传、发布前引导用户在自己的终端执行交互式 `esl login`。AI 绝不输入密码。
- Git 缺失：可以继续做 `search` / `info` / `use` / 已发布技能的远端 `install` / 本地 `validate`；只有 `source clone/upload`、`release publish` 等源码发布流程需要先安装 Git。
- 体检通过后，复述当前目标、范围（项目级/全局、目标工具、版本/命名空间）和下一步，再执行对应流程。

只有当用户目标明确且体检结果满足前置条件时，才进入下面的消费者或作者工作流。不要为了“看起来完整”要求用户提前安装 Docker；普通 CLI 用户不需要 Docker。

## 用结果引导用户，而不是展示命令清单

先用一个问题把用户归类到下面四种任务之一（若用户已经说清楚，就不要重复询问）：

1. **发现并使用**：我想找一个能解决某问题的现成技能；先搜索 → 看详情/版本 → 试用或安装 → 选择项目/全局与工具。
2. **管理已安装技能**：我想查看、更新、修复工具链接或卸载；先列出本地状态 → 明确影响范围 → 再变更。
3. **创建并发布**：我想把想法变成可复用技能；先确认目标用户/输入输出/示例 → 初始化 → 编写 `SKILL.md` 与 references → validate → upload → version → publish。
4. **二次开发/贡献**：我想修改已有技能；先确认来源与权限 → `source clone` → 在本地修改 → validate → upload/publish（不要把 `use` 当成源码下载）。

只问**一个最小澄清问题**，优先问“你想找现成技能，还是创建/修改并发布自己的技能？”；用户回答后再补问真正影响命令的变量：技能身份、项目/全局、目标工具、版本、是否发布/共享。每一步都说明：当前阶段、将改变什么、成功判据、失败后的下一步。

### 面向用户的推荐路径

- **发现**：自然语言目标 → `search --json` → 用描述/版本/可见性筛选 → `info` 复核 → 给出 1–3 个候选及选择理由。
- **试用**：用户只想阅读或验证效果 → `skill use`，不安装、不写盘；明确试用与安装的区别。
- **安装**：确认技能、版本、项目/全局和工具 → 回显完整 `install` 命令 → 用户确认 → 处理工具选择题 → 用 `list --json` 验证安装与 Tool Link。
- **编写**：先问技能要解决的任务、输入、输出、示例和边界 → `source init` → 逐步编辑文件 → `validate` → 用真实小案例试跑 → 再上传。
- **上传/发布**：先 `source status` 和 `validate` → 确认 namespace、远端仓库、版本与可见性 → `source upload`（源码同步/托管）→ `release version` → `release publish`；发布前再次确认，因为发布会对其他用户可见。

不要一次输出完整命令长列表；只在当前阶段展示下一条或一组紧邻命令。对写命令继续遵守下文的确认门槛。
## 先读取用户工作流，再读取命令细节

用户已经明确目标时，先读 `references/workflows.md` 选择最短路径，再读取对应命令 reference。不要把完整命令表一次性展示给用户。
eferences/workflows.md 选择最短路径，再读取对应命令 reference。不要把完整命令表一次性展示给用户。

## 怎么用这个技能

先按下表把用户意图路由到对应 reference，再读那个文件拿到命令清单与旗标。只读命令可直接执行；写命令先回显完整命令、等用户确认再跑。

| 用户说了类似这些 | 读 |
|---|---|
| 先判断用户目标、发现/安装/编写/上传/发布的整体路径 | `references/workflows.md`，再读对应 reference |
| 没装 esl / 安装 CLI / command not found | 先读本文件「命令找不到 / 服务不通」；装好后再 `references/setup.md` |
| 登录 / 登出 / 换服务器 / 我是谁 / token 过期 / 没登录 | `references/setup.md` |
| 搜、找、有没有 X 技能 / 试用 / 装、安装 / link 本地源码、开发模式 / 列出已装、看工具 link 状态 / 更新、升级（含修复已记录 link）/ 卸载 / unlink 源码 / 我的常用工具、偏好工具（`esl config preferred-tools`） | `references/consumer.md` |
| 建、创建、初始化技能 / 校验、看源状态 / 上传源码 / 发布 / 改版本号 / 发布依赖 / 弃用、修订说明、删除版本 / 重命名 / 拉别人源码、二次开发 / 共享授权 | `references/author.md` |
| 执行已接入协议的写命令 / 看到 `questions` 交互负载 | `references/agent-interaction.md` |
| 仍含糊 | 问一个澄清问题（例：「从服务器装现成的，还是自己从零创建？」） |

**Agent Interaction 默认开启。** 本技能由 AI 执行 `esl source init`、裸 `esl release version`、`esl skill install`、`esl link` 或 `esl unlink` 时，命令一律追加
`--agent-interaction` 与 `--agent-tool <tool>`（按当前宿主传工具标识，如
Claude Code 传 `claude-code`、Codex 传 `codex`、Trae 国际版传 `trae-intl`、
Trae 国内版传 `trae-cn`；旧值 `claude` 仍兼容），并同时读取
`references/agent-interaction.md`。不要等用户明确要求选择框或输入框。

Agent 模式下的确认边界：再次安装覆盖已有副本**不必问**；把普通安装改成
Skill Source Link（或反向）属于改安装模式，必须先征得用户同意，再带
`--force` 重跑；缺工具勾选时 CLI 会返回工具多选题，收集后用同一个
`--tools` 重跑即可；站在 Local Skill Source 里做项目级 `link` / `unlink`
需要判定上一级 Consumer Project Root 时，CLI 会返回项目根确认或三选一，用
`--params-json`（`useParent` / `projectRootChoice` / `projectRootPath`）交回。

**站在技能源码里的项目级 `link` / `unlink` 看上一级（ADR-0057）。** cwd 是
Local Skill Source、本身还不是 Consumer Project Root 时，只把技能目录的上一级
当候选项目根（只看一层）：有 `.skills.json` / `.eslib` 静默采用；只有工具点目录
时先确认；都没有则三选一，非交互缺硬证据时失败。`install` / `update` /
`uninstall` / `list` **不**探测上一级，主语是当前 cwd 的 Store；站在
技能源码里 `install` / `update` 写入前拒绝、`list` / `uninstall` 追加
Hint。细节见 `references/consumer.md`。

## 三条不可妥协的规则

**1. 读写分级执行。** 这是核心安全契约。只读、非变更的命令——`esl skill search`、`esl skill info`、`esl skill use`、`esl skill list`/`esl list`/`esl ls`、`esl account whoami`/`esl whoami`、`esl source validate`、`esl source status`、`esl release depend`（无子命令）/ `esl release depend list`——直接跑，跑完把结果给用户；其中 `search` 由 AI 调用时必须加 `--json`，避免进入人类专用 TTY 会话。`list`/`ls` 对人类在 TTY 下会进入**两级交互管理台**（ADR-0058：选技能 → 详情内确认执行 update / 期望 Tool Link 集合对账 / unlink / uninstall），因此 **AI 调用 `list` 一律加 `--json`（或 `--no-input`）保持只读**，变更改调对应专用命令。会改状态或写盘的命令——`esl skill install`/`esl install`、`esl link`、`esl unlink`、`esl skill update`/`esl update`、`esl skill uninstall`/`esl uninstall`、`esl source init`、`esl source upload`、`esl source reset`、`esl source rename`、`esl source clone`、`esl release publish`/`esl publish`、`esl release version`/`esl version`、`esl release deprecate`、`esl release notes`、`esl release delete`、`esl release repair-tag`、`esl skill share`、`esl release depend add`、`esl release depend remove`、`esl account login`/`esl login`、`esl account logout`/`esl logout`、`esl config set-server`、`esl config preferred-tools`——先把你**将要执行**的完整命令（含旗标）回显给用户，等用户明确同意后再跑。被拒绝就停，不要降级、不要换条路偷偷跑。

为什么：`esl skill install` 会把远端内容拉进项目、`esl release publish` 把东西推到全公司共享的服务器、`esl skill uninstall` 删东西——这些不可逆或会被别人看到，用户应当先看清要跑什么。只读命令无成本，直接跑才省事。`list` 管理台的动作每次都经 CLI 确认门闩，但 AI 不应把它当变更入口——那些动作没有 Agent Interaction 协议，AI 无法替用户应答确认框。

**2. 登录不碰密码。** ESL 的认证靠 `esl account login` 拿 token。如果你跑 `esl account whoami` 看到
ot logged in`，或某条命令报 401/认证失败：把用户引到 `references/setup.md`。交互式 `esl account login` 会提示输入密码——这步让用户自己跑，你不要替它键入密码。只有当用户已备好凭据文件时，你才可以执行 `esl account login --username X --token-file ./f` 或 `--password-file ./f`。绝不在命令行里写明文密码或 token。状态不明就先跑 `esl account whoami`。

为什么：密码一旦被你经手（写进命令、落进会话历史或日志），泄露面就放大；让用户在自己终端输入，凭据只存在他本机的只读文件里。

**3. 身份语法别混。** 远端（Server-hosted）技能写全名 `@scope/skill-name`，其中 scope 即其 Namespace（如 `@cnfox/code-review`）；本地草稿目录写相对路径 `./path`，身份走保留 Scope `local`（`@local/*`，系统拦截、无法 `publish`）；内置技能走保留 Scope `builtin`（`@builtin/<skill-name>`，随 CLI 发行、不可 `esl source upload` / `esl release publish` / `esl source clone` / `esl release version` / `esl source rename`）。用户含糊地说"那个技能"时先确认是远端、本地草稿还是内置、是哪个 scope 与短名。**归属写在源码里**：`release.json` 的
ame` 是身份的唯一权威来源（v4，ADR-0032）——`@组织名/短名` 发到组织命名空间（需是该组织成员），裸短名或 `@自己的用户名/短名` 落在个人命名空间；`SKILL.md.name` 只写短名。`esl source init` 默认选 personal、交互式展示编号列表、组织归属也可用 `--namespace <组织名>`；首次 `esl source upload` 会要求确认身份且之后固定（ADR-0039），已托管源改 namespace 会被阻断，`esl release publish` 只断言一致，改归属不得靠改
ame`。`displayName`（v4，ADR-0048）是纯展示标题（可含中文与空格），不参与身份与授权——搜索/列表的标题位优先显示名、`@scope/短名` 作技术名。

## 输出与解析

- 要从结果里取字段、比对、或后续按数据决策时，加 `--json`（`esl skill search`/`esl skill info`/`esl skill list` 支持），你直接解析结构化数据。`search` 面向人类有 TTY 发现会话；Agent 一律用 `--json`。
- 给用户看时用人类可读的默认输出。
- `esl skill use` 只把技能 Prompt 文本打到 stdout、不改项目——适合"试用一下"。可管道传给 Agent：`esl skill use @ns/name | <agent>`。
- 跨平台执行：示例块标 `bash` 只是 shell 高亮，命令本身在 PowerShell/CMD 与 bash/zsh 下等价。PowerShell 中含 `$`、反引号或 `!` 的参数文本（如提交说明、弃用提示）建议改用单引号包裹，避免被当作变量插值。

## Agent 交互

本技能由 AI 驱动，因此对已支持交互协议的命令默认使用 `--agent-interaction`
与 `--agent-tool <tool>`，并先读 `references/agent-interaction.md`。当前
`esl source init` 与裸 `esl release version` 已接入；其他命令按其 reference 或 `--help` 确认。不要让 CLI 在该模式
下等待 stdin，也不要根据普通错误文本猜测是否需要弹窗。

如果命令返回退出码 `2` 且 stdout 是 JSON，读取 `questions` 数组，按宿主
自己的交互界面消费；`metadata.source` 标记来源为 `esl-cli`。

收集后优先使用命令已有的专用 flag，复杂或动态参数使用 `--params-json` 重新
执行同一命令。退出码 `0` 是成功，其他失败按普通错误处理。

## 命令找不到 / 服务不通

- `esl: command not found` / 无法执行 `esl`（bash 报 `command not found`，PowerShell 报「无法将"esl"项识别为 cmdlet」）：别重试同一条业务命令。先做**最短失败卡**（你可代跑只读检查）：
  1.
ode -v`、
pm -v`——需在支持范围（`20.17.x` / `22.x≥22.13` / `24.x`，推荐 24）。缺 Node/npm 时，让用户按人类安装指南分平台安装，**不要**在 skill 里展开 winget/brew/apt 百科。
  2. 指引用户执行
pm install -g @foxian/esl`，然后新开终端跑 `esl --version`。本仓库开发场景可
pm run build`（产出 `packages/cli/dist/bin/esl.js` 的 `esl`）或用仓库文档中的
pm exec -- esl` 方式。
  3. 人类完整步骤（前置、PATH、注册、登录）：仓库内 `docs/guides/cli-install.md`，或 https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md
  4. CLI 可用后，登录与 `config set-server` 走 `references/setup.md`。
- 报「该命令需要 git」（`esl source upload`/`esl release publish`/`esl source clone` 等源码与发布流程）：PATH 里没有 git。提示用户安装 Git（Windows 装 [Git for Windows](https://git-scm.com/download/win)）并确认其在 PATH 后重试；不要绕过或改跑别的命令。
- Server 不可达或连接失败：提示检查 `esl config set-server <url>`。发行包**无**出厂默认 Server；部署者使用自己的 ESL Server URL，本地 Docker 开发常见 `http://localhost:3000`。本地起 Server 指向 `docs/guides/local-development.md`。

现在，先按 `references/workflows.md` 确定用户目标与成功判据，再按上面的路由表读取命令细节。
