---
name: esl-operator
description: >
  Operate the Enterprise Skill Library (ESL) CLI from natural language. Search, try, install, list, update, uninstall, or adapt shared skills into AI tools (Claude Code/Trae/Codex); create, validate, version, publish, or clone the source of skills. Use whenever the user wants to find or use a shared skill, install/update skills (project or global), sync skills into their AI tools, author or publish a skill, pull someone's skill source for edits, or otherwise drive the `esl` command — even when they never say "esl". Routes login and server setup but never types passwords.
---

# esl operator

ESL 是企业技能注册平台；`esl` 是它的 CLI。本技能让你（AI）听懂用户的自然语言意图后，用 bash 真跑 `esl` 命令——不重新实现 CLI 逻辑，只做"意图 → 命令 → 分级执行"的翻译。用户说"搜个 code-review 技能""把我写的技能发出去"，你就知道跑哪条命令。

## 怎么用这个技能

先按下表把用户意图路由到对应 reference，再读那个文件拿到命令清单与旗标。只读命令可直接执行；写命令先回显完整命令、等用户确认再跑。

| 用户说了类似这些 | 读 |
|---|---|
| 登录 / 换服务器 / 我是谁 / token 过期 / 没登录 | `references/setup.md` |
| 搜、找、有没有 X 技能 / 试用 / 装、安装 / 列出已装 / 更新、升级 / 卸载 / 同步到工具、刷到 Claude/Trae/Codex | `references/consumer.md` |
| 建、创建、初始化技能 / 校验 / 上传源码 / 发布 / 改版本号 / 拉别人源码、二次开发 | `references/author.md` |
| 仍含糊 | 问一个澄清问题（例：「从服务器装现成的，还是自己从零创建？」） |

## 三条不可妥协的规则

**1. 读写分级执行。** 这是核心安全契约。只读、非变更的命令——`search` `info` `use` `list/ls` `whoami` `validate`——直接跑，跑完把结果给用户。会改状态或写盘的命令——`install` `update` `uninstall` `adapt` `init` `upload` `publish` `version` `source` `login` `config set-server`——先把你**将要执行**的完整命令（含旗标）回显给用户，等用户明确同意后再跑。被拒绝就停，不要降级、不要换条路偷偷跑。

为什么：`install` 会把远端内容拉进项目、`publish` 把东西推到全公司共享的服务器、`uninstall` 删东西——这些不可逆或会被别人看到，用户应当先看清要跑什么。只读命令无成本，直接跑才省事。

**2. 登录不碰密码。** ESL 的认证靠 `esl login` 拿 token。如果你跑 `esl whoami` 看到 `Not logged in`，或某条命令报 401/认证失败：把用户引到 `references/setup.md`。交互式 `esl login` 会提示输入密码——这步让用户自己跑，你不要替它键入密码。只有当用户已备好凭据文件时，你才可以执行 `esl login --username X --token-file ./f` 或 `--password-file ./f`。绝不在命令行里写明文密码或 token。状态不明就先跑 `esl whoami`。

为什么：密码一旦被你经手（写进命令、落进会话历史或日志），泄露面就放大；让用户在自己终端输入，凭据只存在他本机的只读文件里。

**3. 身份语法别混。** 远端（Server-hosted）技能写全名 `@scope/skill-name`，其中 scope 即其 Namespace（如 `@cnfox/code-review`）；本地草稿目录写相对路径 `./path`，身份走保留 Scope `local`（`@local/*`，系统拦截、无法 `publish`）；内置技能走保留 Scope `builtin`（`@builtin/<skill-name>`，随 CLI 发行、不可 `upload` / `publish` / `source` / `version` / `rename`）。用户含糊地说"那个技能"时先确认是远端、本地草稿还是内置、是哪个 scope 与短名。**发布（`upload`/`publish`）时不需要在源码或命令里写 namespace**——`SKILL.md` 只写短名，完整身份由服务器按 Platform Organization 生成；不要从登录用户名推断或自己拼一个身份。

## 输出与解析

- 要从结果里取字段、比对、或后续按数据决策时，加 `--json`（`search`/`info`/`list` 支持），你直接解析结构化数据。
- 给用户看时用人类可读的默认输出。
- `esl use` 只把技能 Prompt 文本打到 stdout、不改项目——适合"试用一下"。可管道传给 Agent：`esl use @ns/name | <agent>`。

## 命令找不到 / 服务不通

- `esl: command not found`：别重试。告诉用户获取 CLI——本仓库可 `npm run build`（产出 `packages/cli/dist/bin/esl.js` 的 `esl`），或全局装 `@esl/cli`；装好再继续。
- Server 不可达或连接失败：提示检查 `esl config set-server <url>`（本地默认 `http://localhost:3000`）；本地开发环境指向 `docs/guides/local-development.md` 用 Docker 起 Server。

现在，按上面的路由表读对应 reference。
