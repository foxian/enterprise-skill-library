# `esl unlink` 从技能目录推导 Skill Identity

## Problem Statement

`esl link` 的主操作数是本地技能源码目录：可写 `esl link ./path`，也可在目录内省略路径。
`esl unlink` 的主操作数是 Skill Store 中的 Skill Identity，当前强制要求
`<skill-name>`。开发者已经站在刚 link 过的技能目录里时，仍必须手打
`@scope/skill-name`，与 `link` / `publish` / `upload` / `status` 等「默认当前目录」
的手感不一致，也容易在记错身份时误操作。

全局已有 `-C, --cd <path>`，能先切换工作目录再执行子命令；但这只解决「换目录」，
并不提供与 `link ./path` 对称的位置路径写法，也不消除「省略身份」的需求。

## Solution

保持领域模型不变：`unlink` 仍然只按 Skill Identity 解除 Skill Source Link
（ADR-0042）。目录输入（省略、`.`、显式路径）只是 CLI 糖衣，用于从该目录的
Release Manifest（`release.json`）读取 `name` 并推导身份，然后再走既有 unlink
逻辑。

CLI 形态：

```text
esl unlink [skill-name-or-path] [--global]
```

解析规则：

1. 省略参数，或参数为 `.`：以当前工作目录为目标技能目录（已受全局 `-C` 影响）。
2. 参数以 `@` 开头：视为 Skill Identity，行为与今日完全一致。
3. 其他参数：一律视为文件系统路径（相对路径相对于当前 cwd，含 `-C` 之后的 cwd）；
   从该目录读取 `release.json` 推导身份。不得把非 `@` 词牌先当短名身份再回退。

身份推导（只读 `release.json`，与 `link` 默认补全对齐）：

- `name` 为完整 `@scope/skill-name`：原样使用。
- `name` 为裸短名：补全为 `@local/<短名>`。
- 缺少 `release.json`、JSON 无效、或校验失败：失败并提示改传显式 `@scope/skill-name`。

`--global` 语义不变：只在对应一侧 Skill Store 查找并解除；不自动跨 project/global
搜索。

位置路径与 `-C` 可同时出现：位置路径决定「读哪个技能目录的 `release.json`」；
`-C` 只负责先 `chdir`（从而影响相对路径解析起点，以及项目级 unlink 的项目根）。
禁止让 `-C` 静默覆盖位置路径。

当主路径从目录推出的身份在目标 Store 中「未以该身份 link」，但能判定该目录正是
某条 Skill Source Link 的源路径、且已 link 身份不同时，必须给出专用错误，提示
真实已 link 的 Skill Identity，而不是一句含糊的「not linked」。主解析策略仍是
读 `release.json`，不改为「按源路径反查 Install Manifest」优先。

不新开 ADR；不修改 `link` 的路径参数；不把同样糖衣扩展到 `uninstall`。
不要求修订 CONTEXT.md 术语——未引入新领域概念。

## User Stories

1. As a 技能作者, I want 在已 link 的技能目录内运行 `esl unlink [--global]` 且不必手打身份, so that 解除开发链接的摩擦与 `link` 对称。
2. As a 技能作者, I want `esl unlink . [--global]` 与省略参数等价, so that 显式「当前目录」写法可用。
3. As a 技能作者, I want `esl unlink ./my-skill [--global]` 从该目录 `release.json` 推导身份, so that 我不必先 `cd` 再 unlink。
4. As a 技能作者, I want `esl unlink @scope/name [--global]` 继续按显式身份工作, so that 脚本与已知身份的调用不受影响。
5. As a 技能作者, I want 非 `@` 参数一律当路径, so that `markdown-master` 不会被歧义解释成短名身份。
6. As a 技能作者, I want 裸短名 `release.json.name` 按 `@local/<短名>` 推导, so that 与 `link` 默认补全一致。
7. As a 技能作者, I want 目录无效或缺少可用 `release.json` 时得到可行动的错误, so that 我知道改传显式身份。
8. As a 技能作者, I want `--global` 仍然只作用于全局 Store, so that 不会在项目/全局之间静默找错安装面。
9. As a 技能作者, I want `esl unlink -C <dir> <rel-path> --global` 中位置路径决定读取哪个技能目录, so that `-C` 不会覆盖我显式给出的路径。
10. As a 技能作者, I want 当目录推出的身份与真实已 link 身份不一致时看到专用错误（含真实身份）, so that 我能立刻改用正确的 `@scope/name`（例如曾用 `--identity` link，或事后改过 `release.json.name`）。
11. As a 文档/Agent 使用者, I want help 与 `esl-operator` 主推「显式身份 + 目录内省略」, 并将 `./path` / `-C` 标为进阶写法, so that 不会误以为 unlink 的主操作数变成了源码目录或会删除源码。

## Implementation Decisions

- 改动落在 `packages/cli`：`bin/esl.ts` 将 `unlink` 参数改为可选；在进入
  `executeUnlink` 前（或在其内部）完成「身份或目录 → Skill Identity」解析。
- 复用现有 `validateReleaseManifest` / `parseSkillName` 等能力；不为这件糖衣在
  `packages/core` 新造领域类型。
- 目录→身份的解析失败必须发生在任何 Store 变更之前。
- Q2=C 的专用错误：在目标 Store 的 Install Manifest 中查找 `source === 'link'`
  且 `resolved` 与目标目录指向同一路径的条目；若存在且键名 ≠ 推导身份，则报专用
  错误并给出该键名。路径比较须规范化（`path.resolve` / 真实路径策略与现有 link
  测试风格一致）。若找不到此类条目，保持既有「该身份未 link」错误。
- 同步更新：`esl unlink --help` 示例、`skills/esl-operator/references/consumer.md`
  （及若 SKILL 路由表有 unlink 表述则一并核对）。文档主推顺序：显式 `@identity`、
  目录内省略；`./path` 与 `-C` 放进阶。
- 默认不修改 ADR-0042 正文；若实现时发现帮助文本无法单独说清，再考虑在 ADR-0042
  末尾追加一句「CLI 允许从技能目录的 release.json 推导身份」。
- 本次不做：`uninstall` 目录糖衣；按源路径反查作为主解析；去掉 `link` 的路径参数；
  自动跨 project/global 查找。

## Testing Decisions

- 在既有 `packages/cli/tests/link.test.ts`（或紧邻的 unlink 用例）扩展，优先测
  `executeUnlink` / 解析辅助的可观察行为，必要时加薄的 bin 级用例覆盖参数可选。
- 必测：
  - 省略参数 + cwd 下完整 `@scope/name` → 成功 unlink
  - 省略参数 + 裸短名 → 按 `@local/...` unlink
  - 显式 `.` 与省略等价
  - 显式路径 `./skill-dir` 推导并 unlink
  - 显式 `@scope/name` 回归不受影响
  - 非 `@` 且路径不存在/无有效 release.json → 失败且无 Store 变更
  - 推导身份未 link，但目录是另一身份的 link 源 → 专用错误含真实身份
  - `--global` 与项目级隔离：全局 link 后无 `--global` 不得误成功
- 不在本特性中重测 staging 恢复主路径（已有覆盖）；仅保证新解析层接到既有
  `executeUnlink` 后旧用例仍绿。

## Out of Scope / Non-Goals

- 修改 Skill Source Link 的恢复/暂存语义
- `uninstall` / `tools remove` 的目录推导
- 改变 `link --identity` 的补全规则
- 新领域术语或 CONTEXT.md 词条
- 服务端 API 变更

## Acceptance Criteria

- `esl unlink --help` 显示可选的 `[skill-name-or-path]`，并含目录内省略与显式身份示例。
- 在已 link 技能目录内，`esl unlink [--global]`（级别匹配当初 link）成功解除，无需手打身份。
- `esl unlink ./path [--global]` 与 `esl unlink @scope/name [--global]` 在身份一致时等价。
- 非 `@` 参数从不被解释为短名身份。
- 身份不一致场景出现专用错误，且提示真实已 link 身份。
- `skills/esl-operator` 与 CLI 行为锁步更新。
- `npm test` 与 `npm run build` 通过。
