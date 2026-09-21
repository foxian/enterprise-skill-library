# ESL CLI Agent Interaction Protocol

Status: accepted

ESL CLI 需要在 AI Agent 调用命令时表达「命令可以继续，但需要用户选择或输入」。
CLI 不应依赖 Agent 猜测人类提示文本，也不应在 Agent Interaction 模式下阻塞等待
stdin。为此，ESL 定义一个显式的 Agent Interaction Protocol：命令输出机器可读的
交互请求，结束当前进程；Agent 收集用户输入后，使用命令参数重新执行。

## 决策

- 只有显式传入 `--agent-interaction` 时，CLI 才启用该协议。
- `--agent-tool <tool>` 是可选调用方标记，必须在 `--agent-interaction` 模式下
  使用。AI 工具标识使用规范值；Claude Code 使用 `claude-code`，兼容旧值
  `claude`。该参数不改变 stdout 协议。
- 交互请求 JSON 输出到 `stdout`；人类可读日志和诊断输出到 `stderr`。
- 命令需要用户输入时，以退出码 `2` 结束，表示 `interaction_required`。
- 退出码 `0` 表示成功；退出码 `1` 表示普通失败。
- Agent 收集答案后优先使用命令已有的专用 flag；无法自然表达的结构化参数使用
  `--params-json '<JSON object>'` 重新执行命令。
- `--params-json` 只接受顶层 JSON object。JSON 中的字段必须是该命令支持的参数；
  同一参数同时通过专用 flag 和 `--params-json` 传入时直接报错，不定义覆盖优先级。
- `--params-json` 是通用命令参数输入，不是仅用于回答交互问题的答案文件，也不要求
  CLI 在本地生成中间 JSON 文件。
- 密码、token 和其他秘密凭据不进入 Agent Interaction Request；认证命令继续使用
  本机隐藏输入、`--password-file` 或 `--token-file` 等既有安全路径。
- CLI 统一采用 Claude Code `AskUserQuestion` 风格 JSON 作为 Agent
  Interaction 输出：所有工具以及未指定 `--agent-tool` 的调用都输出同一个
  `questions` 数组信封；`esl.interaction.request` 仅保留为 CLI 内部结构，
  不再作为 stdout 协议输出。
- `agentTool` 仍可由命令内部记录，用于诊断和后续扩展，但不进入
  `AskUserQuestion` 输出。

## 交互请求

Agent Interaction 模式下，`stdout` 直接输出与 Claude Code
`AskUserQuestion` 工具输入一致的 JSON：

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

`questions` 由请求字段按顺序映射：`select`/`multiselect` 的 `options` 取自
字段 `options`，选项可携带 `label` 与可选 `description`，`multiSelect` 按字段 `kind` 设置；`confirm` 固定为 `yes`/`no`
两个选项；`text`/`textarea`/`path` 把默认值作为唯一快捷选项（`description`
标记“默认值”），无默认值时为空数组，不臆造选项。答案以 `question` 文本为键
返回；多选取 label 并用逗号拼接。

CLI 内部使用字段描述待收集的用户输入，再将字段映射到 `questions`。字段
`kind` 支持：

- `text`：单行文本；
- `textarea`：多行文本；
- `select`：单选，必须提供 `options`；
- `multiselect`：多选，必须提供 `options`；
- `confirm`：确认值；
- `path`：文件或目录路径。

内部字段可包含 `id`、`kind`、`label`、`description`、`required`、`default`
和 `options`。`options` 接受字符串或 `{ label, description? }`，后者用于把
候选值及其含义一起交给宿主展示。`id` 是参数名或参数名映射的稳定键；Agent
提交时应保持类型，不应把数组或布尔值降级成展示文本。

交互请求只描述本次命令缺少的输入，不改变命令语义，也不让 Agent 重实现命令逻辑。
Agent 应将用户填写的值映射为专用 flag 或 `--params-json`，并重新执行同一命令。

## 参数 JSON

适合专用 flag 的调用仍使用专用 flag：

```bash
esl init ./my-skill --description "代码审查技能" --license MIT
```

需要一次传递多个结构化参数时使用：

```bash
esl init ./my-skill --params-json '{"description":"代码审查技能","license":"MIT","keywords":["git","review"]}'
```

JSON 参数必须经过命令自身的 schema、类型和业务校验。未知字段、非法类型、无效
枚举值和 flag/JSON 重复字段都属于普通参数错误，返回退出码 `1`。

## Agent 处理流程

Agent 通过以下状态判断下一步：

1. 退出码 `0`：命令已完成，正常处理结果。
2. 退出码 `2` 且 stdout 是 JSON：
   - 读取 `questions` 数组，按宿主自己的交互界面消费。
   收集答案后重新执行命令。
3. 其他退出码或不符合协议的输出：按普通 CLI 错误处理，不自动弹出交互控件。

## 兼容性边界

本协议只定义 CLI 与 Agent 宿主之间的交互契约，不要求普通 TTY 改变现有
readline 体验。新增或改变 ESL CLI 的交互行为时，必须同步更新
`skills/esl-operator/` 及其 references；协议字段和退出码的变更必须更新本 ADR。
