# Agent 交互协议

本文件说明 AI Agent 如何消费 ESL CLI 的 Agent Interaction Protocol。协议的权威
设计记录是 `docs/adr/0043-agent-interaction-protocol.md`；本文件只保留执行时需要
的路由和操作规则。

## 触发

本技能由 AI 驱动，默认对已支持协议的 CLI 命令添加：

```bash
esl <command> --agent-interaction --agent-tool <tool>
```

`--agent-tool` 可选，用于标记调用方（Claude Code 用 `claude-code`，兼容旧值
`claude`；Codex 用 `codex`，其余见 `--help`）。无论是否带
`--agent-tool`，stdout 都输出 AskUserQuestion 风格 JSON。只在该模式下处理
结构化交互请求，不要等用户明确说“需要选择框”才添加。普通终端保持现有交互
方式。当前 `init` 与裸 `esl version` 已接入该协议；其他命令先查看其
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

stdout 直接输出与 Claude Code `AskUserQuestion` 工具输入一致的 JSON：

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
  `kind` 设置。选项可包含 `{ label, description }`，Agent 应向用户同时展示。
- `confirm`：`options` 固定为 `yes` / `no`。
- `text` / `textarea` / `path`：把默认值作为唯一快捷选项（`description` 标记
  “默认值”），自定义文本由用户走 Other 输入；没有默认值时不臆造选项。

答案以 `question` 文本为键返回。对 `init`，问题按顺序对应参数
`description`、`license`、`keywords`、`namespace`：单选取所选 `label`；多选
（`keywords`）的多个 label 用逗号拼接；自由文本取用户输入。映射后重新执行同一
命令。对裸 `esl version`，`Release type` 的 `patch` / `minor` / `major` 直接
作为 `release` 参数；自定义 SemVer 走 Other，再作为 `release` 原样传回。

## 传回参数

固定字段优先使用命令自己的 flag：

```bash
esl init ./my-skill --description "代码审查技能" --license MIT
```

多个或嵌套参数使用 `--params-json`：

```bash
esl init ./my-skill --agent-interaction --agent-tool <tool> --params-json '{"description":"代码审查技能","license":"MIT","keywords":["git","review"],"namespace":"personal"}'
```

在 Claude Code、Codex 或 Trae 里运行 `init` 时命令要带对应的 `--agent-tool`，
并按上面的 `AskUserQuestion` 风格输出处理。

裸 `esl version` 的 Agent 回答示例：

```bash
esl version --agent-interaction --agent-tool <tool> --params-json '{"release":"patch"}'
esl version --agent-interaction --agent-tool <tool> --params-json '{"release":"1.4.2"}'
```

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
