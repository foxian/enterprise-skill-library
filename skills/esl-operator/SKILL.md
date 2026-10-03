---
name: esl-operator
description: >
  Operate the Enterprise Skill Library (ESL) CLI from natural language. Search, try, install, list, update, uninstall, link shared skills into AI tools, or link a local skill source into the Skill Store (Claude Code, Codex, Cursor, Trae, WorkBuddy, opencode, OpenClaw, Hermes); inspect or remove tool links; create, validate, version, publish, or clone the source of skills. Use whenever the user wants to find or use a shared skill, install/update skills (project or global), inspect which tools have which skills, author or publish a skill, pull someone's skill source for edits, or otherwise drive the `esl` command — even when they never say "esl". Routes login and server setup but never types passwords.
---

# esl operator

ESL 是企业技能注册平台；`esl` 是它的 CLI。本技能让你（AI）听懂用户的自然语言意图后，在终端里真跑 `esl` 命令——Windows 的 PowerShell、macOS/Linux 的 bash 或 zsh 均可，不重新实现 CLI 逻辑，只做"意图 → 命令 → 分级执行"的翻译。用户说"搜个 code-review 技能""把我写的技能发出去"，你就知道跑哪条命令。

## 怎么用这个技能

先按下表把用户意图路由到对应 reference，再读那个文件拿到命令清单与旗标。只读命令可直接执行；写命令先回显完整命令、等用户确认再跑。

| 用户说了类似这些 | 读 |
|---|---|
| 没装 esl / 安装 CLI / command not found | 先读本文件「命令找不到 / 服务不通」；装好后再 `references/setup.md` |
| 登录 / 登出 / 换服务器 / 我是谁 / token 过期 / 没登录 | `references/setup.md` |
| 搜、找、有没有 X 技能 / 试用 / 装、安装 / link 本地源码、开发模式 / 列出已装 / 更新、升级 / 卸载 / unlink 源码 / 看哪些工具装了哪些技能 / 解除部分工具 link / 修复 link、同步到工具 / 我的常用工具、偏好工具 | `references/consumer.md` |
| 建、创建、初始化技能 / 校验 / 上传源码 / 发布 / 改版本号 / 拉别人源码、二次开发 | `references/author.md` |
| 执行已接入协议的写命令 / 看到 `questions` 交互负载 | `references/agent-interaction.md` |
| 仍含糊 | 问一个澄清问题（例：「从服务器装现成的，还是自己从零创建？」） |

**Agent Interaction 默认开启。** 本技能由 AI 执行 `esl init`、裸 `esl version`、`install` 或 `link` 时，命令一律追加
`--agent-interaction` 与 `--agent-tool <tool>`（按当前宿主传工具标识，如
Claude Code 传 `claude-code`、Codex 传 `codex`、Trae 国际版传 `trae-intl`、
Trae 国内版传 `trae-cn`；旧值 `claude` 仍兼容），并同时读取
`references/agent-interaction.md`。不要等用户明确要求选择框或输入框。

Agent 模式下的确认边界：再次安装覆盖已有副本**不必问**；把普通安装改成
Skill Source Link（或反向）属于改安装模式，必须先征得用户同意，再带
`--force` 重跑；缺工具勾选时 CLI 会返回工具多选题，收集后用同一个
`--tools` 重跑即可。

## 三条不可妥协的规则

**1. 读写分级执行。** 这是核心安全契约。只读、非变更的命令——`search` `info` `use` `list/ls` `tools list` `whoami` `validate` `depend`（无子命令）/ `depend list`——直接跑，跑完把结果给用户；其中 `search` 由 AI 调用时必须加 `--json`，避免进入人类专用 TTY 会话。`list/ls` 对人类在 TTY 下会进入**两级交互管理台**（ADR-0058：选技能 → 详情内确认执行 update / 期望 Tool Link 集合对账 / unlink / uninstall），因此 **AI 调用 `list` 一律加 `--json`（或 `--no-input`）保持只读**，变更改调对应专用命令。会改状态或写盘的命令——`install` `link` `unlink` `update` `uninstall` `tools sync` `tools remove` `init` `upload` `publish` `deprecate` `notes` `release-delete` `share` `version` `source` `reset-source` `depend add` `depend remove` `login` `logout` `config set-server`——先把你**将要执行**的完整命令（含旗标）回显给用户，等用户明确同意后再跑。被拒绝就停，不要降级、不要换条路偷偷跑。

为什么：`install` 会把远端内容拉进项目、`publish` 把东西推到全公司共享的服务器、`uninstall` 删东西——这些不可逆或会被别人看到，用户应当先看清要跑什么。只读命令无成本，直接跑才省事。`list` 管理台的动作每次都经 CLI 确认门闩，但 AI 不应把它当变更入口——那些动作没有 Agent Interaction 协议，AI 无法替用户应答确认框。

**2. 登录不碰密码。** ESL 的认证靠 `esl login` 拿 token。如果你跑 `esl whoami` 看到 `Not logged in`，或某条命令报 401/认证失败：把用户引到 `references/setup.md`。交互式 `esl login` 会提示输入密码——这步让用户自己跑，你不要替它键入密码。只有当用户已备好凭据文件时，你才可以执行 `esl login --username X --token-file ./f` 或 `--password-file ./f`。绝不在命令行里写明文密码或 token。状态不明就先跑 `esl whoami`。

为什么：密码一旦被你经手（写进命令、落进会话历史或日志），泄露面就放大；让用户在自己终端输入，凭据只存在他本机的只读文件里。

**3. 身份语法别混。** 远端（Server-hosted）技能写全名 `@scope/skill-name`，其中 scope 即其 Namespace（如 `@cnfox/code-review`）；本地草稿目录写相对路径 `./path`，身份走保留 Scope `local`（`@local/*`，系统拦截、无法 `publish`）；内置技能走保留 Scope `builtin`（`@builtin/<skill-name>`，随 CLI 发行、不可 `upload` / `publish` / `source` / `version` / `rename`）。用户含糊地说"那个技能"时先确认是远端、本地草稿还是内置、是哪个 scope 与短名。**归属写在源码里**：`release.json` 的 `name` 是身份的唯一权威来源（v4，ADR-0032）——`@组织名/短名` 发到组织命名空间（需是该组织成员），裸短名或 `@自己的用户名/短名` 落在个人命名空间；`SKILL.md.name` 只写短名。`init` 默认选 personal、交互式展示编号列表、组织归属也可用 `--namespace <组织名>`；首次 `upload` 会要求确认身份且之后固定（ADR-0039），已托管源改 namespace 会被阻断，`publish` 只断言一致，改归属不得靠改 `name`。`displayName`（v4，ADR-0048）是纯展示标题（可含中文与空格），不参与身份与授权——搜索/列表的标题位优先显示名、`@scope/短名` 作技术名。

## 输出与解析

- 要从结果里取字段、比对、或后续按数据决策时，加 `--json`（`search`/`info`/`list`/`tools list` 支持），你直接解析结构化数据。`search` 面向人类有 TTY 发现会话；Agent 一律用 `--json`。
- 给用户看时用人类可读的默认输出。
- `esl use` 只把技能 Prompt 文本打到 stdout、不改项目——适合"试用一下"。可管道传给 Agent：`esl use @ns/name | <agent>`。
- 跨平台执行：示例块标 `bash` 只是 shell 高亮，命令本身在 PowerShell/CMD 与 bash/zsh 下等价。PowerShell 中含 `$`、反引号或 `!` 的参数文本（如提交说明、弃用提示）建议改用单引号包裹，避免被当作变量插值。

## Agent 交互

本技能由 AI 驱动，因此对已支持交互协议的命令默认使用 `--agent-interaction`
与 `--agent-tool <tool>`，并先读 `references/agent-interaction.md`。当前
`init` 与裸 `esl version` 已接入；其他命令按其 reference 或 `--help` 确认。不要让 CLI 在该模式
下等待 stdin，也不要根据普通错误文本猜测是否需要弹窗。

如果命令返回退出码 `2` 且 stdout 是 JSON，读取 `questions` 数组，按宿主
自己的交互界面消费；`metadata.source` 标记来源为 `esl-cli`。

收集后优先使用命令已有的专用 flag，复杂或动态参数使用 `--params-json` 重新
执行同一命令。退出码 `0` 是成功，其他失败按普通错误处理。

## 命令找不到 / 服务不通

- `esl: command not found` / 无法执行 `esl`（bash 报 `command not found`，PowerShell 报「无法将"esl"项识别为 cmdlet」）：别重试同一条业务命令。先做**最短失败卡**（你可代跑只读检查）：
  1. `node -v`、`npm -v`——需在支持范围（`20.17.x` / `22.x≥22.13` / `24.x`，推荐 24）。缺 Node/npm 时，让用户按人类安装指南分平台安装，**不要**在 skill 里展开 winget/brew/apt 百科。
  2. 指引用户执行 `npm install -g @foxian/esl`，然后新开终端跑 `esl --version`。本仓库开发场景可 `npm run build`（产出 `packages/cli/dist/bin/esl.js` 的 `esl`）或用仓库文档中的 `npm exec -- esl` 方式。
  3. 人类完整步骤（前置、PATH、注册、登录）：仓库内 `docs/guides/cli-install.md`，或 https://github.com/foxian/enterprise-skill-library/blob/master/docs/guides/cli-install.md
  4. CLI 可用后，登录与 `config set-server` 走 `references/setup.md`。
- 报「该命令需要 git」（`install`/`use` 远程技能、`upload`/`publish`/`source`/`status`/`init`/`version` 等）：PATH 里没有 git。提示用户安装 git（Windows 装 [Git for Windows](https://git-scm.com/download/win)）并确认其在 PATH 后重试；不要绕过或改跑别的命令。`use`/`install` 本地路径与内置技能不依赖 git，可照常执行。
- Server 不可达或连接失败：提示检查 `esl config set-server <url>`。发行包**无**出厂默认 Server；本地 Docker 开发常见 `http://localhost:3000`。本地起 Server 指向 `docs/guides/local-development.md`。

现在，按上面的路由表读对应 reference。
