# ESL CLI Agent Interaction Protocol

Status: accepted

ESL CLI 需要在 AI Agent 调用命令时表达「命令可以继续，但需要用户选择或输入」。
CLI 不应依赖 Agent 猜测人类提示文本，也不应在 Agent Interaction 模式下阻塞等待
stdin。为此，ESL 定义一个显式的 Agent Interaction Protocol：命令输出机器可读的
交互请求，结束当前进程；Agent 收集用户输入后，使用命令参数重新执行。

## 决策

- 只有显式传入 `--agent-interaction` 时，CLI 才启用该协议。
- `--agent-interaction` 可单独使用；不带 `--agent-tool` 时输出通用交互请求
  信封（无 `agentTool`/`uiHint`）。`--agent-tool <tool>` 可选，用于标记调用方，
  只能取 `SUPPORTED_TOOLS` 中的值，且必须在 `--agent-interaction` 模式下使用。
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
- 请求携带 `agentTool` 记录调用方。当 `agentTool` 为 `claude` 时，CLI 直接
  输出与 Claude Code `AskUserQuestion` 工具输入一致的 JSON（`questions`
  数组），宿主可原样透传弹选择模板；其他工具输出通用交互请求信封，可能带
  `uiHint` 作为宿主专属控件建议。

## 交互请求

`--agent-tool claude` 时，`stdout` 直接输出与 Claude Code `AskUserQuestion`
工具输入一致的 JSON：

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
字段 `options`，`multiSelect` 按字段 `kind` 设置；`confirm` 固定为 `yes`/`no`
两个选项；`text`/`textarea`/`path` 把默认值作为唯一快捷选项（`description`
标记“默认值”），无默认值时为空数组，不臆造选项。答案以 `question` 文本为键
返回；多选取 label 并用逗号拼接。

其他工具输出通用交互请求信封：

```json
{
  "type": "esl.interaction.request",
  "schemaVersion": 1,
  "requestId": "ir_example",
  "command": "init",
  "agentTool": "codex",
  "fields": [
    {
      "id": "license",
      "kind": "select",
      "label": "License",
      "required": true,
      "default": "MIT",
      "options": ["MIT", "Apache-2.0", "UNLICENSED"]
    },
    {
      "id": "description",
      "kind": "text",
      "label": "Skill description",
      "required": true
    }
  ]
}
```

`fields` 描述待收集的用户输入。第一版允许的 `kind` 为：

- `text`：单行文本；
- `textarea`：多行文本；
- `select`：单选，必须提供 `options`；
- `multiselect`：多选，必须提供 `options`；
- `confirm`：确认值；
- `path`：文件或目录路径。

字段可包含 `id`、`kind`、`label`、`description`、`required`、`default` 和
`options`。`id` 是参数名或参数名映射的稳定键；Agent 提交时应保持类型，不应把
数组或布尔值降级成展示文本。

请求可包含可选的 `agentTool` 与 `uiHint`。`agentTool` 来自 `--agent-tool`；
`uiHint` 是宿主专属控件建议。当前只有 `claude` 映射到 `AskUserQuestion`，且
该工具在 CLI 侧已被原生输出替换，通用信封主要供其他工具使用。

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
   - 含 `questions` 数组：这是 Claude Code `AskUserQuestion` 风格输入负载，
     宿主原样透传给 `AskUserQuestion` 弹选择模板。
   - `type` 为 `esl.interaction.request`：读取 `agentTool`/`uiHint` 与
     `fields`，按字段渲染选择或输入控件。
   收集答案后重新执行命令。
3. 其他退出码或不符合协议的输出：按普通 CLI 错误处理，不自动弹出交互控件。

## 兼容性边界

本协议只定义 CLI 与 Agent 宿主之间的交互契约，不要求普通 TTY 改变现有
readline 体验。新增或改变 ESL CLI 的交互行为时，必须同步更新
`skills/esl-operator/` 及其 references；协议字段和退出码的变更必须更新本 ADR。
