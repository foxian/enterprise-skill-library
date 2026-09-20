# 裸 `esl version` 交互选择 Release 版本规格

## Problem Statement

ESL 的 Skill Release 版本随 Skill Source 中的 Release Manifest 演进。
`esl version` 会把 `major`、`minor`、`patch` 或显式 SemVer 写入 Release
Manifest，并创建对应的 Release Tag。它已经是 npm 式版本工作流的一部分，
但当前必须显式传入版本参数；直接运行裸 `esl version` 时，用户只会得到缺少
参数的普通 CLI 错误。

这带来两个问题。第一，用户需要自己记住版本类型的名称和各自含义，无法在选择
前看到实际目标版本。第二，CLI 的其他需要用户补充信息的路径已经使用 Inquirer
或 Agent Interaction Protocol 提供交互与结构化请求，而版本命令仍然只有“记住
参数”这一种入口，体验和自动化能力不一致。

## Solution

让 `esl version` 的版本参数变为可选。用户在交互式终端中直接运行裸
`esl version` 时，先完成 Git、Release Manifest 和工作区预检，再通过单选界面
选择 `patch`、`minor`、`major` 或自定义 SemVer。每个预设选项显示当前版本计算
出的目标版本和使用场景，选择后直接执行，不增加二次确认。

显式参数路径继续保留，适合脚本、CI 和已经知道目标版本的调用方。非交互环境
和 `--no-input` 不会自动选择默认版本，而是立即报错，避免意外创建 commit 和
Release Tag。

裸命令在 `--agent-interaction` 模式下输出 AskUserQuestion 风格的交互请求，
由 AI 工具向用户收集版本类型，再通过命令参数或 `--params-json` 重新执行。
人类终端和 Agent 看到相同的目标版本说明，但普通终端不会阻塞 Agent 调用。

## User Stories

1. As an ESL 技能作者, I want 直接运行裸 `esl version` 时看到版本类型选择, so that 我不需要先记住所有可选参数。
2. As an ESL 技能作者, I want 在选择前看到当前版本计算出的 patch 目标版本, so that 我能判断这次改动是否适合补丁发布。
3. As an ESL 技能作者, I want 在选择前看到 minor 和 major 的目标版本, so that 我能区分兼容新增与破坏性变更。
4. As an ESL 技能作者, I want 每个版本类型带有简短用途说明, so that 我不需要临时查阅 SemVer 文档。
5. As an ESL 技能作者, I want `patch` 作为默认高亮项, so that 常见修复发布可以快速完成。
6. As an ESL 技能作者, I want 选择预设版本后直接执行, so that 交互路径不比显式参数更繁琐。
7. As an ESL 技能作者, I want 输入自定义 SemVer, so that 我可以发布预设递增无法表达的版本。
8. As an ESL 技能作者, I want 自定义 SemVer 非法时原地重新输入, so that 一次输错不会中断整个版本流程。
9. As an ESL 技能作者, I want 自定义版本支持预发布 SemVer, so that 内部预览版本可以正常创建和打 tag。
10. As an ESL 技能作者, I want build metadata 和 `v` 前缀被拒绝, so that Release Manifest 保持统一的版本格式。
11. As an ESL 技能作者, I want 选择版本类型后不出现额外确认, so that 裸命令和显式参数拥有一致的执行节奏。
12. As an ESL 技能作者, I want 取消选择或输入时立即停止, so that 不会发生未明确选择的版本写入、commit 或 tag。
13. As an ESL 技能作者, I want 取消被视为中断而不是普通业务错误, so that 终端不会显示误导性的 `Error: canceled`。
14. As an ESL 技能作者, I want Git、Release Manifest 和工作区检查在选择前完成, so that 我不会选完版本后才发现命令根本不能执行。
15. As an ESL 技能作者, I want 工作区不干净时在选择前失败, so that 版本 commit 不会混入未提交改动。
16. As an ESL 技能作者, I want `schemaVersion: 1` 的旧清单只提供自定义 SemVer 入口, so that 我可以通过迁移初始化而不是执行非法 bump。
17. As an ESL 技能作者, I want 预发布版本的 `patch|minor|major` 使用标准 SemVer 递增规则, so that 不会看到 `1.2.NaN` 这类无效目标版本。
18. As an ESL 技能作者, I want 稳定版本的递增结果保持现状, so that 新增交互不会改变既有发布结果。
19. As an ESL CLI 用户, I want 显式传入 `patch`、`minor`、`major` 或 SemVer 时不显示交互, so that 熟悉的命令和脚本继续直接执行。
20. As an ESL CLI 用户, I want `esl --version` 继续只显示 CLI 自身版本, so that Skill Release 版本命令与 CLI 包版本不会混淆。
21. As an ESL CLI 用户, I want 非 TTY 环境中的裸命令立即失败, so that CI 或管道调用不会等待人工输入。
22. As an ESL CLI 用户, I want `--no-input` 下的裸命令立即失败, so that 交互式终端中的自动化调用也能保证绝不弹出提示。
23. As an ESL CLI 用户, I want 非交互失败提示显式参数用法, so that 我能立即修正脚本。
24. As an ESL CLI 用户, I want 自动化调用使用显式参数, so that 版本选择不依赖终端能力和默认项。
25. As an AI Agent 调用方, I want 裸命令在 `--agent-interaction` 下输出结构化问题, so that 我可以通过宿主的原生选择控件收集版本类型。
26. As an AI Agent 调用方, I want Agent 问题中的选项包含目标版本说明, so that 用户拥有与普通终端相同的决策信息。
27. As an AI Agent 调用方, I want 自定义版本通过 AskUserQuestion 的 Other 输入, so that Agent 不需要发明额外协议。
28. As an AI Agent 调用方, I want 显式传参时 `--agent-interaction` 不产生无意义问题, so that 可以直接执行已经明确的版本变更。
29. As an AI Agent 调用方, I want 通过 `--params-json` 回传版本参数, so that 结构化回答可以直接重新执行原命令。
30. As an AI Agent 调用方, I want 同一版本参数不能同时通过位置参数和 JSON 传递, so that 参数优先级保持明确且无歧义。
31. As an AI Agent 调用方, I want 非法 Agent 回答按普通参数错误处理, so that 自动化流程可以统一处理退出码 `1`。
32. As an AI Agent 调用方, I want `--no-input` 优先于 Agent Interaction, so that 禁止交互的调用方不会被结构化问题反向绕过。
33. As an ESL CLI 维护者, I want 版本选择逻辑位于 CLI 交互层, so that 版本命令模块继续只负责预检、写入、commit 和 tag。
34. As an ESL CLI 维护者, I want 复用现有版本命令预检和 SemVer 计算, so that 交互路径与显式参数路径不会产生行为漂移。
35. As an ESL CLI 维护者, I want 不新增自定义 Inquirer prompt 类型, so that 交互迁移继续依赖 `@inquirer/prompts` 的标准能力。
36. As an ESL CLI 维护者, I want 只通过现有命令行程序边界验证主要行为, so that 测试不耦合终端渲染和 Inquirer 内部实现。
37. As an ESL CLI 维护者, I want 保留显式参数路径的回归测试, so that 新增交互不会破坏脚本兼容性。
38. As an ESL CLI 维护者, I want 同步更新 Agent Interaction ADR 和内置 `esl-operator` 技能, so that 客户端配套说明与实际 CLI 行为保持一致。
39. As an ESL CLI 维护者, I want 完整测试和构建通过, so that 新交互可以在当前 Node.js 运行时稳定发布。

## Implementation Decisions

- `esl version` 的位置参数由必填改为可选；显式传入 `major | minor | patch | <SemVer>` 时继续走现有执行路径。
- 参数解析优先级固定为：显式参数直接执行；没有显式参数时，`--no-input` 优先失败；否则 Agent Interaction 输出结构化问题；否则仅 TTY 显示普通交互；其余环境失败。
- `--no-input` 的语义保持“禁止所有 prompt”。裸命令没有可安全推断的默认版本，因此在 `--no-input` 下必须返回缺少版本参数的普通错误。
- 显式参数路径不触发交互，即使同时启用了 `--agent-interaction`。
- 普通交互和 Agent Interaction 都在输出问题前完成同一套预检：Built-in Skill 拒绝、Git 仓库检查、Release Manifest 存在性与有效性、工作区干净检查，以及当前 Release 版本读取。
- 预检失败属于普通命令失败，不输出交互问题，也不改写 Release Manifest、Git commit 或 Release Tag。
- 有效 Release Manifest 且当前版本可读取时，三个预设选项的目标值使用既有 `semver` 依赖计算。
- 预设选项使用稳定值 `patch`、`minor`、`major` 作为答案；展示信息由“选项标签 + 版本说明”组成，分别是目标版本和用途说明。
- 普通终端默认高亮 `patch`，并提供自定义 SemVer 选项。
- 选择任一预设后直接执行，不增加额外确认步骤。
- 自定义 SemVer 使用与显式参数路径相同的校验：允许预发布版本，拒绝 build metadata、`v` 前缀和非法格式。
- 普通终端中的非法自定义 SemVer 在输入位置重新询问；Agent 回传的非法版本作为普通参数错误返回。
- 预发布版本的递增计算改用 `semver.inc()`，修复现有实现对预发布版本产生 `NaN` 的问题。稳定版本的 `patch|minor|major` 结果保持不变。
- `schemaVersion: 1` 的旧 Release Manifest 在预检后仍可迁移，但只提供自定义 SemVer；Agent Interaction 对应该情形发送文本输入字段，而不是伪造 bump 候选。
- `version` 加入 Agent Interaction 支持范围。正常 Release Manifest 对应一个 AskUserQuestion 风格问题，选项是三个带目标版本说明的预设值；自定义版本由 Other 提供。
- Agent Interaction 的内部字段选项增加描述能力，输出结构仍保持 AskUserQuestion 的 `{ label, description }`，不新增外部信封或自定义 JSON 协议。
- Agent 回答优先使用位置参数；需要结构化参数时支持 `--params-json` 的 `release` 字段。
- `--params-json` 只接受该命令支持的顶层字段；未知字段、非法类型和位置参数/JSON 重复字段均返回普通参数错误。
- 取消普通选择或自定义输入时，命令以中断语义结束，不进入版本写入、commit 或 tag 阶段。
- 版本命令核心继续负责 Release Manifest 写入、commit 和 Release Tag；CLI 交互层只负责模式判断、收集版本输入和调用核心执行路径。
- 版本命令核心的现有公开调用契约保持不变，普通命令层不直接实现 Git 或 Release Manifest 业务逻辑。
- 相关 ADR、用户指南和内置 `esl-operator` 技能同步说明：裸命令可交互，自动化必须传参，Agent Interaction 使用结构化问题，`--no-input` 禁止等待输入。
- 不修改 Release 服务端 API、数据库结构、版本解析规则、发布流程或 `esl publish` 行为。

## Testing Decisions

- 测试只验证用户可观察行为：退出码、stdout Agent JSON、Inquirer 是否被调用、传入的选项内容、错误信息、Release Manifest 内容、Git commit 和 Release Tag，不断言 ANSI 渲染细节。
- 主测试接缝是现有 CLI 程序执行边界：通过 `createProgram()` / `run()` 启动命令，模拟 Inquirer 和终端状态，并使用临时真实 Git 技能仓库验证文件与 tag 结果。
- 主接缝覆盖以下行为：
  - TTY 下裸命令显示选择器，默认项为 `patch`，选项包含正确目标版本和用途说明；
  - 选择 `patch`、`minor`、`major` 和自定义 SemVer 后执行正确结果；
  - 非法自定义版本触发重新输入，取消不产生文件或 Git 副作用；
  - 显式参数不调用 prompt；
  - `--no-input` 和非 TTY 下裸命令失败且不调用 prompt；
  - Git 缺失、Release Manifest 缺失、旧 schema 和工作区不干净等预检问题发生在 prompt 之前；
  - Agent Interaction 输出 AskUserQuestion 风格问题及选项描述；
  - `--params-json`、重复参数和非法 Agent 回答的退出行为；
  - `--no-input` 优先于 `--agent-interaction`；
  - 预发布版本的预设目标计算不产生 `NaN`。
- 现有 `executeVersion()` 测试继续作为显式参数和版本写入的回归接缝，并补充预发布版本递增的数学断言；不通过该接缝重复覆盖 CLI 路由和交互。
- 现有 Agent Interaction 字段映射测试继续作为协议接缝，验证选项描述正确映射为 `{ label, description }`，并保持现有字段类型行为不回归。
- 测试复用现有 CLI 程序解析测试、临时 Git 仓库版本命令测试和 Agent Interaction 映射测试的风格，不引入真实终端按键仿真或 `@inquirer/testing`。
- 完成后运行定向测试、完整 `npm test` 和 `npm run build`。

## Out of Scope

- 不改变显式 `esl version <release>` 的命令名称、参数值或成功输出；唯一例外是修复预发布版本递增产生 `NaN` 的既有缺陷。
- 不在非 TTY 或 `--no-input` 中自动选择 `patch`。
- 不新增 `--major`、`--minor`、`--patch` 或 `--preid` 等版本选择旗标。
- 不改变 `esl --version`，CLI 包自身版本仍由包元数据提供。
- 不改变 Release Tag 命名、commit message、push 策略或 `esl publish` 流程。
- 不引入 npm dist-tag、自动 prerelease 序列或版本通道概念。
- 不修改 `esl publish` 的版本读取逻辑。
- 不修改服务端 Release 校验、版本解析、依赖锁定或数据库结构。
- 不为所有命令重建通用交互状态机。
- 不增加 `@inquirer/testing`、真实 TTY 仿真或自定义 Inquirer prompt 类型。
- 不移除或放宽 `--no-input`。
- 不处理与裸 `esl version` 交互无关的现有未提交 Agent Interaction 改动。

## Further Notes

- 本规格建立在 #66 的 `@inquirer/prompts` 基础迁移之上，但属于新的命令行为，不与工具选择 checkbox 混在同一实现范围。
- 设计沿用 ADR-0030 的 npm 式版本工作流：版本存在 Release Manifest 中，`esl version` 负责本地 commit 和 Release Tag，不负责 push。
- Agent Interaction 输出继续遵循 ADR-0043 的 AskUserQuestion 风格、退出码和 `--params-json` 契约。
- 当前工作区可能包含尚未提交的 Agent Interaction 改动；实现本规格时应与其共存，不回滚或覆盖无关修改。
- `esl version` 指的是 Skill Release 版本子命令；不要与 `esl --version` 的 CLI 自身版本输出混淆。
