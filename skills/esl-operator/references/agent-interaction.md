# Agent 交互协议

本文件说明 AI Agent 如何消费 ESL CLI 的 Agent Interaction Protocol。协议只用于**选项由服务端或运行时决定**的问题；选项事先已知的决策（AI 工具、`source init` 的静态字段、版本类型、项目根）按 `SKILL.md` 的「先收集选择」用宿主原生提问控件完成，不要为它们加 `--agent-interaction`。协议的权威设计记录是 `docs/adr/0043-agent-interaction-protocol.md`；本文件只保留执行时需要的行为规则。

## 触发

技能只在这两类问题上主动使用协议（CLI 本身对其它已接入命令也支持该模式，但静态选项应提前传参，不要触发问题）：

- `esl source init` 的 Namespace：选项来自服务端的组织成员列表。
- `esl skill update` / `esl skill uninstall` 的依赖清理候选与删除影响：选项来自运行时依赖图。

命令写法：

```shell
esl <command> --agent-interaction --agent-tool <tool>
```

`--agent-tool` 可选，用于标记调用方（Claude Code 用 `claude-code`，兼容旧值 `claude`；Codex 用 `codex`，其余见 `--help`）。无论是否带 `--agent-tool`，stdout 都输出 AskUserQuestion 风格 JSON。普通终端保持现有交互方式。

## 判断结果

- 退出码 `0`：命令成功，继续处理 stdout。
- 退出码 `2` 且 stdout 是 JSON：
  - 读取 `questions` 数组，按宿主自己的交互界面消费，`metadata.source` 标记来源为 `esl-cli`。
  - 收集答案后重新执行同一命令。
- 退出码 `1` 或其他不符合协议的输出：按普通错误处理，不自动弹出控件。

stdout 只按 JSON 协议解析；stderr 只作为人类可读日志或诊断信息，不当作字段值。

## AskUserQuestion 风格输出

stdout 输出 AskUserQuestion 风格的 JSON 负载；`questions` 可用于宿主适配，`metadata` 是 ESL 来源标记，不应直接传入不接受该字段的宿主工具：

```json
{
  "questions": [
    {
      "question": "Namespace",
      "header": "Namespace",
      "options": [{ "label": "personal" }, { "label": "acme" }],
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

## update / uninstall：依赖清理与删除影响确认

两个命令共用同一套依赖规则（ADR-0072）：

- **清理多选**（`multiselect`）：更新或卸载后 CLI 列出不再需要的传递依赖。
  默认全部不勾选；用户不选表示保留，CLI 会持久记录保留意图，后续命令不会
  再把这些副本当作孤儿自动回收。选项中的 `All dependencies`（等价于
  `--cleanup all`）表示全选；人工终端的复选列表按 `a` 也可全选。
- **影响确认**（`confirm`）：删除仍被其他技能依赖的目标时，问题文案列出直接
  或间接受影响的技能。默认不是已确认；用户明确接受后才执行删除，且只删目标、
  保留上游技能。
- 清理时若某个未选中的候选依赖了已选中的项，CLI 会拒绝扩大删除，或发出影响
  确认；不能借多选绕过确认。

用 `--cleanup` 或 `--params-json` 交回清理选择：

```shell
esl update @acme/markdown-master --agent-interaction --params-json '{"cleanup":["@acme/old"]}'
esl update @acme/markdown-master --agent-interaction --params-json '{"cleanup":[]}'   # 全部保留
esl uninstall @acme/root --agent-interaction --cleanup @acme/old,@acme/stale
```

确认影响后，把问题文案里列出的受影响技能原样交回
`--accept-dependency-impact`，或用 `--params-json '{"acceptDependencyImpact":[...]}'`：

```shell
esl uninstall @acme/shared --agent-interaction --accept-dependency-impact @acme/root-a,@acme/root-b
```

- 重跑会重新计算依赖关系；影响集合超出上次交回的范围时，CLI 会再次以退出码
  `2` 询问，不能把先前同意泛化到新增技能。
- `--force` 表示接受本次命令实际检查到的全部影响；它不绕过清理多选，也不把
  无人值守默认保留变成删除授权。
- 普通无人值守脚本不传影响确认时，删除仍被依赖的目标会以普通错误失败（退出码
  `1`），不会执行该删除。

## init：只剩 Namespace

`source init` 的 description、license、keywords、display name 按 `SKILL.md` 用专用 flag 直接传；只有需要组织列表时才加协议旗标，让返回的问题只包含 Namespace。首跑只带协议旗标，拿到 Namespace 问题、用户选定组织后再用 `--params-json` 重跑：

```shell
esl source init ./my-skill --agent-interaction --agent-tool <tool>
# 用户选择组织 acme 后
esl source init ./my-skill --agent-interaction --agent-tool <tool> --params-json '{"namespace":"acme"}'
```

用户明确归属个人时直接 `--namespace personal`，完全不进入协议；不要猜组织名，也不要替用户确认首次身份。Namespace 的选项是服务端返回的成员组织，不要凭印象补全。

## 传回参数

`--params-json` 的值必须是顶层 JSON object。只传命令支持的字段；不要把同一字段
同时放进专用 flag 和 JSON。未知字段、重复字段或类型错误都应让 CLI 返回普通失败。

宿主答案格式不统一；先把答案关联回原 `question`，再按当前问题映射参数，不依赖问题数组的固定顺序。无法识别的问题先查命令帮助，不猜参数键。

## 宿主适配与无工具降级

先确认宿主交互工具在当前模式可用，再把 `questions` 映射到该工具接受的输入格式；不要假定所有宿主都接受 ESL 的整份 JSON。选项数、自由文本或多选不受支持时，用简短文字补问缺失字段。

没有可用交互工具时，直接向用户询问当前必要字段并等待真实答案，不代填默认值、不让 CLI 等待 stdin，也不无参数地反复重跑。每次重跑保留已经收集的参数；后续仍返回退出码 2 时处理新问题，直到成功或普通失败。写命令仍按主文档回显并确认，协议不豁免确认门槛。

## 凭据安全

密码、token 和其他秘密不通过 Agent Interaction Request 或 `--params-json` 传递。
登录或改密时让用户在自己的终端完成隐藏输入，或使用 `--password-file`、
`--token-file`。不要把秘密写进命令、JSON、对话内容或日志。
