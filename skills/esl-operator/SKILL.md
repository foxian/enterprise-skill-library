---
name: esl-operator
description: >
  通过自然语言操作 Enterprise Skill Library（ESL）CLI：搜索、试用、安装、查看、更新或卸载 ESL 技能，管理工具链接，以及初始化、校验、克隆、上传和发布技能源码。当用户明确提到 esl、ESL 企业技能库、@builtin/esl-operator，或上下文已确定使用 ESL 实例时使用。不要求每条请求都包含 esl。仅创作或优化技能内容、进行技能评测时使用 skill-forge；未确定使用 ESL 的通用技能发现或 GitHub 安装请求不默认走本技能。指导登录和 Server 配置，但不代输密码。
---

# esl operator

ESL 是企业技能注册平台；`esl` 是它的 CLI。本技能让你（AI）听懂用户的自然语言意图后，在终端里真跑 `esl` 命令——Windows 的 PowerShell、macOS/Linux 的 bash 或 zsh 均可，不重新实现 CLI 逻辑，只做"意图 → 命令 → 分级执行"的翻译。用户说"搜个 code-review 技能""把我写的技能发出去"，你就知道跑哪条命令。


## 按任务做最小环境检查

先判断用户目标和技能来源，再按 `references/workflows.md` 的「环境按任务检查」矩阵选择前置条件；该矩阵是唯一的任务前置清单。矩阵是按条件取用的映射，不是每次任务都要完整执行的预检清单。只读检查可直接执行，不把所有检查串成必经流程。

- 直接执行用户明确要求的 ESL 命令；只有命令找不到、启动失败，或需要切换 CLI 执行器时，才运行 `esl --version` 并按下文失败卡选择可用执行器。Node/npm 存在不代表全局 npm 目录可写。
- 在同一任务中固定一个 CLI 执行器：优先已有的 `esl`，其次是沙箱可写目录中的项目级安装，再其次是带明确版本的 `npx --yes @foxian/esl@<version>`；不要在 `esl`、裸 `npx esl` 和不同版本之间混用。
- 全局安装的 `esl` 可能在普通命令启动时提示稳定版更新；提示不改变当前命令。只有用户明确要求更新时才运行 `esl self-update`，并让 CLI 自己请求确认。项目级安装和 `npx` 不执行 CLI 自更新；Agent/JSON 模式不输出旁路更新提示。
- 本地查看、内置安装和本地校验不要求 Server 或登录。只有远端任务需要 Server；需要鉴权时再检查 `esl account whoami`。
- 只在源码或发布流程需要时检查 `git --version`；已发布包的 HTTP 安装不依赖 Git。
- 同一任务内已成功确认的 CLI、Server、登录和 Git 状态直接复用；只有命令报出对应条件缺失、任务切换到需要该条件的阶段，或用户明确要求重新核验时才再次检查。
- 缺失当前任务的前置条件时，读取 `references/setup.md` 的对应章节。公开云端未指定地址时使用默认
  `https://cloud.enterprise-skills.com/`；只有私有、自托管或本地 Server 才需要向用户确认地址。
  写入 `config set-server` 前仍须确认用户确实要覆盖默认地址，密码由用户在自己的终端输入。
- **多 Server 实例**：每个 ESL Server 实例有稳定的 Instance ID，地址只是连接方式。
  `whoami`、登录、登出和认证请求都绑定**当前地址所属实例**；切换实例不会清除另一个
  实例的登录，也不会把旧实例的 token/用户/邮箱/组织展示给新实例。当前地址身份未确认
  时（`identity unconfirmed`）认证命令在发送凭据前停止，`logout` 也拒绝猜测清理。
  `esl config server list` 查看和管理实例与地址；TTY 下进入「实例 → 地址 → 操作」流程，
  只有确认后才切换/删除。AI 或脚本必须用 `--json` 或 `--no-input`，这两种模式只读。
  `esl config server add <url>` 登记备用地址（身份发现失败时保存为待确认）；
  `esl config server use <instance-id-or-url>` 切换当前实例；`esl config server remove`
  只删除本地登记，**不会**删除已安装技能或服务器数据；删除最后一个地址会同时清理该
  实例本地凭据，删除当前地址时会先回退到同一实例的其他已确认地址。
  新地址声称已知 Instance ID 时会提示“可能是伪造”的安全警告，必须由用户确认或显式追加
  `--accept-new-address`；已登记地址返回不同 Instance ID 时 CLI 会 fail-closed，必须先
  移除旧登记再重新添加。不要建议用户为日常 install/update 传 `--instance-id`：
  CLI 默认使用当前选中实例。

目标明确且满足当前任务前置条件后再执行。普通 CLI 用户不需要 Docker。

## 用结果引导用户，而不是展示命令清单

先用一个问题把用户归类到下面四种任务之一（若用户已经说清楚，就不要重复询问）：

1. **发现并使用**：我想找一个能解决某问题的现成技能；先搜索 → 看详情/版本 → 试用或安装 → 选择项目/全局与工具。
2. **管理已安装技能**：我想查看、更新、修复工具链接或卸载；先列出本地状态 → 明确影响范围 → 再变更。
3. **创建并发布**：用户已明确要通过 ESL 管理技能源码；内容创作与评测交给 `skill-forge`，本技能负责初始化 → validate → upload → version → publish。只改内容时不擅自进入上传或发布流程。
4. **二次开发/贡献**：我想修改已有技能；先确认来源与权限 → `source clone` → 在本地修改 → validate → upload/publish（不要把 `use` 当成源码下载）。

目标不明确时只问**一个最小澄清问题**；随后仅补问影响命令的变量：技能身份、项目/全局、目标工具、版本、是否发布/共享。只读查询直接给结果；写操作说明影响范围与成功判据，失败时给出下一步。

## 按需读取参考文件

简单查询直接读取下表中对应文件的相关章节；多阶段或目标含糊的任务，再读取 `references/workflows.md` 的对应场景。不要一次读取所有参考文件，也不要展示完整命令清单。所有 `references/` 路径均相对本技能根目录。

## 怎么用这个技能

先按下表把用户意图路由到对应 reference，再读那个文件拿到命令清单与旗标。只读命令可直接执行；写命令先回显完整命令、等用户确认再跑。

| 用户说了类似这些 | 读 |
|---|---|
| 先判断用户目标、发现/安装/编写/上传/发布的整体路径 | `references/workflows.md`，再读对应 reference |
| 没装 esl / 安装 CLI / command not found / 沙箱不能全局安装 | 先读本文件「命令找不到 / 服务不通」；装好后再 `references/setup.md` |
| 登录 / 登出 / 换服务器 / 我是谁 / token 过期 / 没登录 | `references/setup.md` |
| 搜、找、有没有 X 技能 / 试用 / 装、安装 / link 本地源码、开发模式 / 列出已装、看工具 link 状态 / 更新、升级（含传递依赖与清理旧依赖）/ 卸载（含选择性清理、依赖缺失）/ unlink 源码 / 我的常用工具、偏好工具（`esl config preferred-tools`） | `references/consumer.md` |
| 建、创建、初始化技能 / 校验、看源状态 / 上传源码 / 发布 / 改版本号 / 发布依赖 / 弃用、修订说明、删除版本 / 重命名 / 拉别人源码、二次开发 / 共享治理（看谁有权限、授权与撤销、切可见性） | `references/author.md` |
| 要选工具 / 版本类型 / 项目根，或看到 `questions` 交互负载 | 本文件「先收集选择」；服务端或运行时选项见 `references/agent-interaction.md` |
| 仍含糊 | 问一个澄清问题（例：「从服务器装现成的，还是自己从零创建？」） |

## 先收集选择：静态选项自己问，动态选项走协议

判断标准只有一条：**选项是不是事先就知道**。

- **枚举固定或本地可判断**（AI 工具、`source init` 的 description / license / keywords / display name、版本类型、项目根）→ 在对话里直接问，把答案翻译成命令旗标，一条命令跑完；不要为这些问题加 `--agent-interaction`。
- **选项由服务端或运行时决定**（`source init` 的 Namespace 组织列表、`update` / `uninstall` 的依赖清理候选与删除影响）→ 读 `references/agent-interaction.md`，消费退出码 `2` 返回的 `questions`。CLI 对其它命令也支持该模式，但技能不主动使用。

**怎么问**：优先用宿主的原生提问控件（Claude Code 的 `AskUserQuestion`，其他宿主用等价的选项控件或文本编号选项）。一次问 3–4 个问题；选项显示展示名，提交时换回规范 id；license、显式 SemVer、项目根目录这类自由输入走 Other 或直接文本。不要等用户主动要求选择框。

**AI 工具标识**（展示名 → `--tools` / `--agent-tool` 的提交值）：

| 展示名 | 提交 id |
|---|---|
| Claude Code | `claude-code`（等价别名 `claude`） |
| Codex | `codex` |
| Cursor | `cursor` |
| Trae International | `trae-intl` |
| Trae CN | `trae-cn` |
| WorkBuddy | `workbuddy` |
| OpenCode | `opencode` |
| OpenClaw | `openclaw` |
| Hermes | `hermes` |

工具数超过单次选项上限时，按「已有 Tool Link → `esl config preferred-tools` 的常用工具 → 其余」排序，先给前几个，其余让用户自由输入 id。

**`install` / `link`**：必须显式给 `--tools <id,id>` 或 `--no-tools`，非交互缺工具集合会直接失败。覆盖安装不必额外确认；普通安装与 Skill Source Link 互转必须先征得用户同意再带 `--force`。

**`source init`**：先问齐 description、license、keywords、display name 并直接传参——缺字段时 CLI 会静默套默认值，不能靠它补问。只有需要组织列表时才加 `--agent-interaction --agent-tool <tool>`，让返回的问题只剩 Namespace；个人技能直接传 `--namespace personal`，完全不进入协议。

**`release version`**：问 patch / minor / major 或显式 SemVer，用位置参数 `esl release version patch`；可从本地 `release.json` 算出下一版本作为参考。

**项目根（ADR-0057）**：先按 `references/consumer.md`「站在 Skill Source 里的项目根」判断上一级是否可作为 Consumer Project Root；需要交回时用 `--params-json` 的 `useParent` / `projectRootChoice` / `projectRootPath`。`install` / `update` / `uninstall` / `list` 不探测上一级。

**`update` / `uninstall` 的依赖清理默认全部不勾选**；CLI 返回清理多选时用 `--cleanup`（或 `--params-json '{"cleanup":[...]}'`）交回选择，空数组表示全部保留。删除仍被其他技能依赖的目标会先返回影响确认；确认后用 `--accept-dependency-impact <受影响的技能列表>` 交回本次看到的范围，影响扩大时 CLI 会再次询问。`--force` 只代表接受当前检查到的全部影响，模式开关不构成删除授权。

## 三条不可妥协的规则

**1. 读写分级执行。** 这是核心安全契约。只读、非变更的命令——`esl skill search`、`esl skill info`、`esl skill use`、`esl skill list`/`esl list`/`esl ls`、`esl account whoami`/`esl whoami`、`esl config server list --json`（或 `--no-input`）、`esl source validate`、`esl source status`、`esl release depend`（无子命令）/ `esl release depend list`、`esl skill share`（**无任何目标旗标**，查看权限矩阵）——直接跑，跑完把结果给用户；其中 `search` 由 AI 调用时必须加 `--json`，避免进入人类专用 TTY 会话。`list`/`ls` 对人类在 TTY 下会进入**两级交互管理台**（ADR-0058：选技能 → 详情内确认执行 update / 期望 Tool Link 集合对账 / unlink / uninstall），因此 **AI 调用 `list` 一律加 `--json`（或 `--no-input`）保持只读**，变更改调对应专用命令。会改状态或写盘的命令——`esl skill install`/`esl install`、`esl link`、`esl unlink`、`esl skill update`/`esl update`、`esl skill uninstall`/`esl uninstall`、`esl source init`、`esl source upload`、`esl source reset`、`esl source export`、`esl source clean`、`esl source rename`、`esl source clone`、`esl release publish`/`esl publish`、`esl release version`/`esl version`、`esl release deprecate`、`esl release notes`、`esl release delete`、`esl release repair-tag`、`esl skill share`（带任何目标旗标：`--all` / `--team` / `--user` / `--revoke-team` / `--revoke-user` / `--visibility` / `--clear-grants`，清空授权时非交互需 `--force`）、`esl release depend add`、`esl release depend remove`、`esl account whoami --online`/`esl whoami --online`、`esl account login`/`esl login`、`esl account logout`/`esl logout`、`esl config set-server`、`esl config server list`（TTY 管理台：确认后才切换/删除）、`esl config server add`/`use`/`remove`、`esl config preferred-tools`——先把你**将要执行**的完整命令（含旗标）回显给用户，等用户明确同意后再跑。AI 调用 `config server list` 一律加 `--json` 或 `--no-input`，避免进入 TTY 管理台。被拒绝就停，不要降级、不要换条路偷偷跑。

为什么：`esl skill install` 会把远端内容拉进项目、`esl release publish` 把东西推到全公司共享的服务器、`esl skill uninstall` 删东西——这些不可逆或会被别人看到，用户应当先看清要跑什么。只读命令无成本，直接跑才省事。`list` 管理台的动作每次都经 CLI 确认门闩，但 AI 不应把它当变更入口——那些动作由 CLI 自己的确认框把关，AI 无法替用户应答。

**2. 登录不碰密码。** ESL 的认证靠 `esl account login` 拿 token。如果你跑 `esl account whoami` 看到 `Not logged in`，或某条命令报 401/认证失败：把用户引到 `references/setup.md`。交互式 `esl account login` 会提示输入密码——这步让用户自己跑，你不要替它键入密码。只有当用户已备好凭据文件时，你才可以执行 `esl account login --username X --token-file ./f` 或 `--password-file ./f`。绝不在命令行里写明文密码或 token。状态不明就先跑 `esl account whoami`。

为什么：密码一旦被你经手（写进命令、落进会话历史或日志），泄露面就放大；让用户在自己终端输入，凭据只存在他本机的只读文件里。

**3. 身份语法别混。** 远端（Server-hosted）技能写全名 `@scope/skill-name`，其中 scope 即其 Namespace（如 `@cnfox/code-review`）；本地草稿目录写相对路径 `./path`，身份走保留 Scope `local`（`@local/*`，系统拦截、无法 `publish`）；内置技能走保留 Scope `builtin`（`@builtin/<skill-name>`，随 CLI 发行、不可 `esl source upload` / `esl release publish` / `esl source clone` / `esl release version` / `esl source rename`）。用户含糊地说"那个技能"时先确认是远端、本地草稿还是内置、是哪个 scope 与短名。**归属写在源码里**：`release.json` 的 `name` 是身份的唯一权威来源（v4，ADR-0032）——`@组织名/短名` 发到组织命名空间（需是该组织成员），裸短名或 `@自己的用户名/短名` 落在个人命名空间；`SKILL.md.name` 只写短名。`esl source init` 默认选 personal、交互式展示编号列表、组织归属也可用 `--namespace <组织名>`；首次 `esl source upload` 会要求确认身份且之后固定（ADR-0039），已托管源改 namespace 会被阻断，`esl release publish` 只断言一致，改归属不得靠改 `name`。`displayName`（v4，ADR-0048）是纯展示标题（可含中文与空格），不参与身份与授权——搜索/列表的标题位优先显示名、`@scope/短名` 作技术名。

**ESL 源码 Git 认证只走 ESL CLI。** 对 Server-hosted Source 的 `esl` remote，禁止直接执行 `git fetch`、`git pull` 或 `git push` 作为同步路径，也不要要求用户再次输入 Git 用户名和密码。统一使用 `esl source status`、`esl source upload`、`esl source clone` 等命令；CLI 会复用本机 ESL 登录产生的 Skill User Token，并只在当前 Git 子进程中临时注入认证 Header。源码目录、remote URL 和 Git 全局配置不得写入 ESL 密码或 Token。`git status`、`git diff`、`git log` 等本地诊断，以及用户编辑冲突文件，仍可直接使用 Git。

为什么：ESL 登录态和 Git Backend 访问使用同一个 Skill User Token；再次弹 Git 密码说明调用绕过了 ESL CLI，不应通过给每个源码目录保存一套凭据来修复。

## 输出与解析

- 要从结果里取字段、比对、或后续按数据决策时，加 `--json`（`esl skill search`/`esl skill info`/`esl skill list` 支持），你直接解析结构化数据。`search` 面向人类有 TTY 发现会话；Agent 一律用 `--json`。
- 下载量（#137）：`search` 每条结果带 `downloadCount`（跨版本累计，0 表示从未下载）；`info` 顶层 `downloadCount` 是总量，`releases[]` 每条带该版本自身的 `downloadCount`（`versions` 仍是纯 `string[]`，下载量明细只在 `releases[]`）。人类可读输出里 `info` 的 `Versions:` 逐行列出「版本 + 该版本下载量」，`search` 非交互行按固定列序 `name / displayName / latestStableVersion / visibility / downloadCount / description`（`description` 固定最后一列）制表符分隔。
- 给用户看时用人类可读的默认输出。
- `esl skill use` 只把技能 Prompt 文本打到 stdout、不改项目——适合"试用一下"。可管道传给 Agent：`esl skill use @ns/name | <agent>`。
- 跨平台执行：示例块标 `bash` 只是 shell 高亮，命令本身在 PowerShell/CMD 与 bash/zsh 下等价。PowerShell 中含 `$`、反引号或 `!` 的参数文本（如提交说明、弃用提示）建议改用单引号包裹，避免被当作变量插值。

## 遇到 `questions` 交互负载

只有服务端或运行时决定的问题会以退出码 `2` 返回 JSON：读取 `questions`，收集答案后用同一命令的专用 flag 或 `--params-json` 重跑，`metadata.source` 是 `esl-cli`。不要让 CLI 在该模式下等待 stdin，也不要根据普通错误文本猜测是否需要弹窗。完整流程见 `references/agent-interaction.md`。

## 命令找不到 / 服务不通

- `esl: command not found` / 无法执行 `esl`（bash 报 `command not found`，PowerShell 报「无法将"esl"项识别为 cmdlet」）：别重试同一条业务命令。先做**最短失败卡**（你可代跑只读检查）：
  1. `node -v`、`npm -v`、`npx --version`——Node 支持范围以 `references/setup.md` 的 CLI engines 为准，推荐 24.x。缺 Node/npm 时，让用户按人类安装指南分平台安装，**不要**在 skill 里展开 winget/brew/apt 百科。
  2. 如果宿主允许全局安装，展示并确认 `npm install -g @foxian/esl`，然后新开终端跑 `esl --version`。如果出现权限、只读全局目录或 PATH 错误，不要反复重试，也不要把它误判成 Node 缺失。
  3. 沙箱有可写工作区或缓存目录时，展示并确认项目级安装，例如 `npm install --prefix .esl-runtime @foxian/esl@<version>`；验证 `./.esl-runtime/node_modules/.bin/esl --version`（PowerShell 使用对应的 `.cmd`），后续固定使用这个路径。若不希望留下安装目录，再使用 `npx --yes @foxian/esl@<version> --version`，后续命令也必须使用相同的固定版本。
  4. 不要推荐裸 `npx esl`。项目级安装与 `npx` 都需要 npm 缓存或目标目录可写，并可能需要访问 registry；都失败时，说明需要宿主预装 `@foxian/esl` 或提供持久化的可写目录。
  5. 本仓库开发场景可 `npm run build`（产出 `packages/cli/dist/bin/esl.js` 的 `esl`）或用仓库文档中的 `npm exec -- esl` 方式；人类完整步骤（前置、PATH、注册、登录）见仓库内 `docs/guides/cli-install.md`，或 https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md。
  6. CLI 可用后，登录与 `config set-server` 走 `references/setup.md`；一次性沙箱可用 `ESL_SERVER=<url>` 临时指定 Server，避免把配置写进会被清理的用户目录。
- 报「该命令需要 git」（`esl source upload`/`esl release publish`/`esl source clone` 等源码与发布流程）：PATH 里没有 git。提示用户安装 Git（Windows 装 [Git for Windows](https://git-scm.com/download/win)）并确认其在 PATH 后重试；不要绕过或改跑别的命令。
- Server 不可达或连接失败：先确认当前目标是公开云端还是私有 / 自托管 / 本地实例。未指定地址时公开云端默认是
  `https://cloud.enterprise-skills.com/`；需要切换实例时再提示检查 `esl config set-server <url>`。
  本地 Docker 开发常见 `http://localhost:4070`，本地起 Server 指向 `docs/guides/local-development.md`。

执行后按对应场景验证结果；安装使用 `esl skill list --json` 核对作用域与 Tool Link，上传和发布分别确认源码状态与已发布版本，不把上传成功当作发布成功。

- **跨实例播种**：参照 `references/author.md` 的 `source export` 流程导出 `<短名>-export/`，先审查副本，再由目标企业 Maintainer 确认 namespace 并上传；不要改源目录的 `.git`/remote。
- **原地去身份**：用户明确要把当前技能目录清成只剩文档和代码时，用 `esl source clean [path] --force`；它删除 `.git` 与 `release.json`，不替代 export。


技能授权遵循组织边界：组织技能的 `--user` 目标必须是当前组织成员；个人技能可授权已启用的平台用户，填写完整平台用户名。团队和成员权限可通过相同目标旗标重新设置，无需先撤销。详见 `references/author.md` 的授权说明。

## 发布包与二进制文件

- 当前发布包使用 ZIP，不再把所有文件作为 JSON 文本传输；ZIP 内的 Word 文档、图片和其他二进制文件按原始字节保存。
- 新版 CLI 安装器兼容 ZIP 和历史 JSON 发布包。升级 CLI 后再安装新发布的版本；已经损坏的旧 JSON 包无法由安装器恢复，必须从完好源码重新发布。
- 正式发布以服务端固定源码 commit 为准，发布流程是：固定 commit → 按固定提交读取源码快照 → 加入发布元信息并做必要文本调整 → 生成 ZIP → 计算 checksum → 保存发布包。
- `release publish --dry-run` 只预演校验和临时打包，不保存正式包、不创建 Release 或 tag、不安装依赖、不执行技能脚本；仅服务端返回 404 时，才使用本地固定提交 blob 的 Base64 回退，不读取工作树。符号链接和子模块不支持打包，Git LFS 外部内容不会自动下载。
