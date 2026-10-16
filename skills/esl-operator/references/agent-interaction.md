# Agent 交互协议

本文件说明 AI Agent 如何消费 ESL CLI 的 Agent Interaction Protocol。协议的权威
设计记录是 `docs/adr/0043-agent-interaction-protocol.md`；本文件只保留执行时需要
的路由和操作规则。

## 触发

本技能由 AI 驱动，默认对已支持协议的 CLI 命令添加：

```shell
esl <command> --agent-interaction --agent-tool <tool>
```

`--agent-tool` 可选，用于标记调用方（Claude Code 用 `claude-code`，兼容旧值
`claude`；Codex 用 `codex`，其余见 `--help`）。无论是否带
`--agent-tool`，stdout 都输出 AskUserQuestion 风格 JSON。只在该模式下处理
结构化交互请求，不要等用户明确说“需要选择框”才添加。普通终端保持现有交互
方式。当前 `esl source init`、裸 `esl release version`、`esl skill install`、`esl link` 与 `esl unlink` 已接入该协议；其他命令先查看其
reference 或 `--help`。

## 判断结果

- 退出码 `0`：命令成功，继续处理 stdout。
- 退出码 `2` 且 stdout 是 JSON：
  - 读取 `questions` 数组，按宿主自己的交互界面消费，`metadata.source`
    标记来源为 `esl-cli`。
  - 收集答案后重新执行同一命令。
- 退出码 `1` 或其他不符合协议的输出：按普通错误处理，不自动弹出控件。

stdout 只按 JSON 协议解析；stderr 只作为人类可读日志或诊断信息，不当作字段值。

## AskUserQuestion 风格输出

stdout 输出 AskUserQuestion 风格的 JSON 负载；`questions` 可用于宿主适配，`metadata` 是 ESL 来源标记，不应直接传入不接受该字段的宿主工具：

```json
{
  "questions": [
    {
      "question": "License",
      "header": "License",
      "options": [{ "label": "MIT", "description": "默认值" }],
      "multiSelect": false
    }
  ],
  "metadata": { "source": "esl-cli" }
}
```

对外字段只有 `question`、`header`、`options`、`multiSelect`：

- 按 `multiSelect` 区分单选与多选，同时展示选项的 `label` 和可选 `description`。
- 自定义文本允许自由输入；默认值以快捷选项展示，没有选项时直接询问文本。
- `yes` / `no` 选项表示确认题；默认选项不等于用户已经确认。
- `kind`、`id`、`default` 是 CLI 内部字段，不出现在 stdout，不能依赖它们渲染或映射参数。

## install / link：只问工具多选

Agent 模式下 `install` / `link` 不会发覆盖安装或模式转换的 y/n 题：覆盖静默进行；
把普通安装改成 Skill Source Link（或反向）必须由用户明确同意后带 `--force` 重跑，
否则 CLI 以普通错误退出（退出码 1）。

当未传 `--tools` 且不是 `--no-tools` 时，CLI 以退出码 `2` 发出一个 `multiSelect`
工具题：

- 选项标签是展示名（Claude Code、Trae International…），description 里的
  `id: <tool>` 是提交值。
- 问题文案含「First tool mount」时表示这是该技能的首次工具挂载，预选的是
  本机常用工具，而不是已有 link。
- 收集答案后用**同一个** `--tools` 旗标重跑，提交规范 id（逗号分隔）：
  `esl skill install @acme/review --agent-interaction --tools claude,codex`。

## link / unlink：站在 Local Skill Source 里的项目根

站在技能源码目录里做项目级 `link` / `unlink` 时，CLI 先判定上一级 Consumer
Project Root（ADR-0057）：上一级已有 `.skills.json` / `.eslib` 静默采用；只有
工具点目录时发一道 `confirm`（默认 Yes，问题文案列出发现的点目录）；都没有时发
一道 `select`（初始化上一级 / 指定另一个目录 / 改全局）。选项的规范值在
description 的 `choice: <值>`，Agent 用 `label` 或 `choice` 值都可交回。

用 `--params-json` 重跑：

```shell
# 弱证据：采用上一级（Yes）
esl link --agent-interaction --params-json '{"useParent":true}'
# 弱证据选否 / 无证据：改用全局
esl link --agent-interaction --params-json '{"useParent":false,"projectRootChoice":"global"}'
# 初始化上一级 / 指定另一个目录
esl link --agent-interaction --params-json '{"projectRootChoice":"init"}'
esl link --agent-interaction --params-json '{"projectRootChoice":"directory","projectRootPath":"../my-app"}'
```

`--no-input` / 非交互在缺硬证据时以普通错误失败并列出可行动选项，不会猜一个项目
根。项目根问完后才会继续问工具。

宿主答案格式不统一；先把答案关联回原 `question`，再按当前命令映射参数，不依赖问题数组的固定顺序。

| init 问题 | 专用 flag / params-json 键 | 值 |
|---|---|---|
| Skill description | `--description` / `description` | 文本 |
| License | `--license` / `license` | 文本，例如用户选择的 MIT |
| Keywords | `--keywords` / `keywords` | flag 用逗号分隔，JSON 用字符串数组 |
| Display name | `--display-name` / `display-name` | 文本；不是内部字段名 displayName |
| Namespace | `--namespace` / `namespace` | 用户选择的 label |

例如上面的 stdout 只询问 License，用户明确选择 MIT 后，保留原命令及已确认的其他参数，追加 `--license MIT` 重跑；不要把 `question`、`header` 或整份宿主答案当成 CLI 参数。

对裸 `esl release version`，`Release type` 的 patch/minor/major 或 `Version` 的明确 SemVer 映射到 `release`。工具和项目根的参数映射按上面的对应章节处理。无法识别的问题先查命令帮助，不猜参数键。

## 传回参数

固定字段优先使用命令自己的 flag：

```shell
esl source init ./my-skill --description "代码审查技能" --license MIT
```

多个或嵌套参数使用 `--params-json`：

```shell
esl source init ./my-skill --agent-interaction --agent-tool <tool> --params-json '{"description":"代码审查技能","license":"MIT","keywords":["git","review"],"display-name":"代码审查","namespace":"personal"}'
```

在 Claude Code、Codex 或 Trae 里运行 `esl source init` 时命令要带对应的 `--agent-tool`，
并按上面的 `AskUserQuestion` 风格输出处理。

裸 `esl release version` 的 Agent 回答示例：

```shell
esl release version --agent-interaction --agent-tool <tool> --params-json '{"release":"patch"}'
esl release version --agent-interaction --agent-tool <tool> --params-json '{"release":"1.4.2"}'
```

`--params-json` 的值必须是顶层 JSON object。只传命令支持的字段；不要把同一字段
同时放进专用 flag 和 JSON。未知字段、重复字段或类型错误都应让 CLI 返回普通失败。

## 宿主适配与无工具降级

先确认宿主交互工具在当前模式可用，再把 `questions` 映射到该工具接受的输入格式；不要假定所有宿主都接受 ESL 的整份 JSON。选项数、自由文本或多选不受支持时，用简短文字补问缺失字段。

没有可用交互工具时，直接向用户询问当前必要字段并等待真实答案，不代填默认值、不让 CLI 等待 stdin，也不无参数地反复重跑。每次重跑保留已经收集的参数；后续仍返回退出码 2 时处理新问题，直到成功或普通失败。写命令仍按主文档回显并确认，协议不豁免确认门槛。

## 凭据安全

密码、token 和其他秘密不通过 Agent Interaction Request 或 `--params-json` 传递。
登录或改密时让用户在自己的终端完成隐藏输入，或使用 `--password-file`、
`--token-file`。不要把秘密写进命令、JSON、对话内容或日志。
