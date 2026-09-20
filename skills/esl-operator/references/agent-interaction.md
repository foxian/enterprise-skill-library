# Agent 交互协议

本文件说明 AI Agent 如何消费 ESL CLI 的 Agent Interaction Protocol。协议的权威
设计记录是 `docs/adr/0043-agent-interaction-protocol.md`；本文件只保留执行时需要
的路由和操作规则。

## 触发

本技能由 AI 驱动，默认对已支持协议的 CLI 命令添加：

```bash
esl <command> --agent-interaction --agent-tool <tool>
```

`--agent-tool` 必须与 `--agent-interaction` 成对出现，取值来自
`SUPPORTED_TOOLS`（Claude Code 用 `claude`、Codex 用 `codex`，其余见
`--help`）。只在该模式下处理结构化交互请求，不要等用户明确说“需要选择框”才
添加。普通终端保持现有交互方式。当前 `init` 已接入该协议；其他命令先查看其
reference 或 `--help`。

## 判断结果

- 退出码 `0`：命令成功，继续处理 stdout。
- 退出码 `2` 且 stdout 是 JSON：
  - 含 `questions` 数组：这是 Claude Code `AskUserQuestion` 风格的输入负载
    （`--agent-tool claude`）。把 `questions` 原样交给宿主 `AskUserQuestion`
    弹选择模板，`metadata.source` 标记来源为 `esl-cli`。
  - `type` 是 `esl.interaction.request`：按 `agentTool`/`uiHint` 与 `fields`
    渲染控件。
  - 收集答案后重新执行同一命令。
- 退出码 `1` 或其他不符合协议的输出：按普通错误处理，不自动弹出控件。

stdout 只按 JSON 协议解析；stderr 只作为人类可读日志或诊断信息，不当作字段值。

## AskUserQuestion 风格输出（claude）

`--agent-tool claude` 时，stdout 直接输出与 Claude Code `AskUserQuestion` 工具
输入一致的 JSON，宿主可原样透传弹出选择模板：

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

字段映射规则：

- `select` / `multiselect`：`options` 取自字段 `options`；`multiSelect` 按字段
  `kind` 设置。
- `confirm`：`options` 固定为 `yes` / `no`。
- `text` / `textarea` / `path`：把默认值作为唯一快捷选项（`description` 标记
  “默认值”），自定义文本由用户走 Other 输入；没有默认值时不臆造选项。

答案以 `question` 文本为键返回。对 `init`，问题按顺序对应参数
`description`、`license`、`keywords`、`namespace`：单选取所选 `label`；多选
（`keywords`）的多个 label 用逗号拼接；自由文本取用户输入。映射后重新执行同一
命令。其他工具没有 AskUserQuestion 输出时，按 `esl.interaction.request` 信封的
字段 `kind` 用各自宿主常规控件渲染。

## 传回参数

固定字段优先使用命令自己的 flag：

```bash
esl init ./my-skill --description "代码审查技能" --license MIT
```

多个或嵌套参数使用 `--params-json`：

```bash
esl init ./my-skill --agent-interaction --agent-tool <tool> --params-json '{"description":"代码审查技能","license":"MIT","keywords":["git","review"],"namespace":"personal"}'
```

在 Claude Code 里运行 `init` 时命令要带 `--agent-tool claude`，并按上面的
`AskUserQuestion` 风格输出弹选择模板。

`--params-json` 的值必须是顶层 JSON object。只传命令支持的字段；不要把同一字段
同时放进专用 flag 和 JSON。未知字段、重复字段或类型错误都应让 CLI 返回普通失败。

## 字段类型

根据 `kind` 渲染控件：

- `text`：单行输入；
- `textarea`：多行输入；
- `select`：单选；
- `multiselect`：多选；
- `confirm`：确认；
- `path`：文件或目录路径。

使用 `id` 作为参数键，保留 `default` 和 `options` 的类型。用户未确认的默认值
不能擅自提交。

## 凭据安全

密码、token 和其他秘密不通过 Agent Interaction Request 或 `--params-json` 传递。
登录或改密时让用户在自己的终端完成隐藏输入，或使用 `--password-file`、
`--token-file`。不要把秘密写进命令、JSON、对话内容或日志。
