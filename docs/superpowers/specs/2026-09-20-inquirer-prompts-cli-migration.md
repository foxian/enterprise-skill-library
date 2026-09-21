# @inquirer/prompts CLI 交互迁移规格

## Problem Statement

ESL CLI 当前使用 Node.js `readline` 自行实现文本输入、密码输入、确认和工具选择。基础提示逻辑分散在自定义实现中，密码回显控制依赖 `readline` 的内部方法，工具选择也依赖手写编号解析。

这导致交互体验和行为维护成本较高，也使工具选择无法提供标准的多选交互。与此同时，CLI 已经支持 `--no-input`，但工具选择路径只判断当前是否为 TTY；在交互式终端中显式传入 `--no-input` 时，仍可能弹出工具选择。

## Solution

使用 `@inquirer/prompts` 作为 CLI 的交互提示实现，并保留现有 CLI prompt 适配层的公开函数签名。基础输入、隐藏输入和确认逻辑继续由适配层承载，命令模块不直接依赖 Inquirer。

将 AI 工具选择改为 checkbox 多选。交互终端中未指定工具且没有项目或全局默认配置时，用户可以从支持的工具中选择一个或多个；至少选择一个工具仍是必要条件。

`--no-input` 继续保留，并明确表示禁止所有交互提示。工具选择允许发生的条件是当前终端可交互且没有启用 `--no-input`。非交互环境或显式禁用输入时，如果没有 `--tools`、默认工具配置或 `--no-tools`，命令应立即失败而不是等待输入。

## User Stories

1. As an ESL CLI 用户, I want 普通文本输入使用统一的交互提示实现, so that CLI 的输入体验保持一致。
2. As an ESL CLI 用户, I want 密码输入仍然完全不回显, so that 密码不会出现在终端输出中。
3. As an ESL CLI 用户, I want 密码输入可以通过现有的适配层调用, so that 登录和改密流程不需要知道底层提示库。
4. As an ESL CLI 用户, I want 确认提示继续返回布尔值, so that发布、上传和重置流程无需改变业务判断。
5. As an ESL CLI 用户, I want 确认提示的直接回车保持否定语义, so that 未明确确认时不会继续执行危险操作。
6. As an ESL CLI 用户, I want `install` 在没有工具配置时看到多选工具界面, so that我可以一次选择多个 AI 工具。
7. As an ESL CLI 用户, I want `link` 在没有工具配置时看到多选工具界面, so that本地技能可以链接到多个 AI 工具。
8. As an ESL CLI 用户, I want `tools remove` 在没有工具参数时看到多选工具界面, so that我可以选择要移除的多个工具链接。
9. As an ESL CLI 用户, I want checkbox 返回我选择的工具标识, so that后续链接操作使用准确的工具集合。
10. As an ESL CLI 用户, I want 空工具选择被拒绝, so that命令不会在没有任何目标工具时继续执行。
11. As an ESL CLI 用户, I want 空工具选择在交互界面中得到明确提示, so that我知道必须至少选择一个工具。
12. As an ESL CLI 用户, I want 工具选择函数在返回后仍防御性校验空数组, so that未来替换提示实现时仍保持业务契约。
13. As an ESL CLI 用户, I want `--tools all` 继续选择全部支持的工具, so that脚本化调用不依赖交互界面。
14. As an ESL CLI 用户, I want `--tools claude,codex` 继续选择指定工具, so that自动化流程可以精确控制工具集合。
15. As an ESL CLI 用户, I want `--no-tools` 继续跳过工具链接, so that我可以只安装技能源。
16. As an ESL CLI 用户, I want 在非交互环境中缺少工具选择信息时立即失败, so that CI 或管道任务不会无限等待输入。
17. As an ESL CLI 用户, I want 在交互终端中使用 `--no-input` 时也立即失败, so that我可以显式保证 CLI 不会弹出任何提示。
18. As an ESL CLI 用户, I want `--no-input` 和非 TTY 环境拥有一致的工具选择行为, so that自动化执行结果不依赖运行环境是否附带终端。
19. As an ESL CLI 用户, I want prompt 被取消时命令停止执行, so that取消操作不会继续安装、链接或移除工具。
20. As an ESL CLI 用户, I want prompt 取消被视为中断而不是普通业务错误, so that退出行为不会显示误导性的普通错误信息。
21. As an ESL CLI 维护者, I want 命令模块继续依赖稳定的 prompt 适配层, so that未来替换提示库时无需修改所有命令。
22. As an ESL CLI 维护者, I want 基础 prompt 适配层保持现有函数签名, so that现有命令注入点和测试替身继续有效。
23. As an ESL CLI 维护者, I want 适配层测试验证外部行为而不是 Inquirer 内部渲染, so that测试不会依赖终端 ANSI 输出细节。
24. As an ESL CLI 维护者, I want 工具选择测试覆盖非交互、空选择和取消, so that高风险分支有稳定回归保护。
25. As an ESL CLI 维护者, I want 内置 `esl-operator` 技能说明 checkbox 和自动化参数行为, so that客户端配套技能不会指导用户使用过时的编号交互。
26. As an ESL CLI 维护者, I want 新增依赖满足当前支持的 Node.js 运行时, so that CLI 可以在 Node.js `24.16.0` 上稳定构建和运行。

## Implementation Decisions

- 在 CLI 包中引入当前最新的 `@inquirer/prompts` 版本范围；目标运行时为 Node.js `24.16.0`，不为旧版 Node.js 18 做兼容性降级。
- 保留现有 prompt 适配层作为唯一的基础交互边界。
- `readText`、`readHidden` 和 `confirm` 的公开函数签名不变，调用方不需要改用 Inquirer 类型。
- `readHidden` 使用密码提示但保持完全不回显，并关闭临时显示密码的交互能力。
- `confirm` 使用否定默认值，保持直接回车不确认的语义。
- 工具选择使用 checkbox，选择项来自当前支持工具集合，返回 `ToolName[]`。
- 不增加交互式 “All” 伪选项；交互用户逐项选择全部工具，自动化调用继续使用 `--tools all`。
- checkbox 在交互过程中阻止空提交，并在工具选择函数返回后再次校验空数组，保持稳定的 `No tools selected` 错误契约。
- `--no-input` 保留为全局 CLI 旗标，语义是禁止所有 prompt。
- 工具选择的允许条件是交互式终端且未启用 `--no-input`。
- 当没有显式工具参数、项目配置或全局配置时，非交互环境和 `--no-input` 都必须立即报错，并提示使用 `--tools`、`--tools all` 或 `--no-tools`。
- prompt 取消应停止当前命令并沿用 CLI 的中断退出语义，不调用后续安装、链接或移除操作。
- 工具选择测试使用依赖注入的 checkbox 实现和现有 CLI 命令解析 seam；不引入终端按键仿真依赖。
- 内置 `esl-operator` 消费者文档同步说明 checkbox 交互、至少选择一个工具，以及非交互或 `--no-input` 下的显式参数要求。

## Testing Decisions

- 测试只验证可观察行为：返回值、错误契约、命令是否继续执行，以及 prompt 是否被调用；不验证 Inquirer 的内部渲染实现。
- 基础适配层沿用现有 prompt 测试风格，覆盖普通输入返回文本、密码输入不泄露输入内容、提示文本可见和确认返回值。
- 工具选择测试覆盖：
  - checkbox 返回单个工具和多个工具时，结果保持相同顺序和标识；
  - checkbox 返回空数组时，得到 `No tools selected`；
  - checkbox 被取消时，取消错误继续传播；
  - 非交互环境没有配置时，命令报错且不调用安装、链接或移除执行函数；
  - 交互终端传入 `--no-input` 时，命令同样报错且不调用工具选择；
  - `--tools` 和 `--no-tools` 的既有行为不回归。
- CLI 集成测试使用现有的命令程序解析测试，mock 业务执行函数，验证参数选择逻辑和执行边界。
- 依赖安装后运行 CLI prompt 定向测试，再运行完整 `npm test` 和 `npm run build`。

## Out of Scope

- 不改变 `install`、`link`、`tools remove` 的命令名称、位置参数、旗标名称或业务执行逻辑。
- 不移除或重命名 `--no-input`。
- 不改变 `--tools all`、逗号分隔工具列表或 `--no-tools` 的脚本化语义。
- 不引入新的自定义 Inquirer prompt 类型。
- 不引入 `@inquirer/testing` 或真实终端按键仿真测试框架。
- 不重构所有命令的交互条件判断为新的通用状态机。
- 不处理与本次交互迁移无关的现有未提交 `agent-interaction` 改动。
- 不新增领域术语、数据库结构、Server API 或 Skill Release 行为。

## Further Notes

- 当前工作区包含未提交的 agent interaction 改动；实现本规格时应与其共存，不回滚或覆盖。
- 当前 CLI 的 prompt 适配层是最高稳定 seam，命令层不应直接依赖 `@inquirer/prompts`。
- `--no-input` 的核心价值是让调用方在交互式终端中也能显式禁止等待人工输入，这对 Agent 和 CI 调用尤其重要。
