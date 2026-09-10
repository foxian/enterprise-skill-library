# reset-source 只承载脱管步骤、不串联重新登记

Status: accepted

ADR-0021 规定：orphan 重新注册只保留「`git remote remove esl` + 重新 `esl upload`」
的显式手动两步路径。第二步（重新 upload）必须显式发起没有争议；但第一步是纯
本地 git 操作，用户在「源已被服务器删除」的场景（ADR-0027 探测失败而确认）下
需要反复执行，且手敲命令容易漏掉配套动作（如旧 Release Manifest 在重传后被
沿用，其依赖声明指向已删技能）。我们决定：**提供 `esl reset-source` 命令，
只封装脱管第一步**——移除 `esl` Source Remote，并把 `release.json` 改名保留为
`release.json.before-reset`；第二步重新 upload 永远是用户显式的下一句命令。

- **绝不串联**：reset-source 不调用任何服务器变更 API，不自动 upload；两步
  结构原样保留（ADR-0021「不提供单步接管入口」语义不变——单步指「删而复立」，
  本命令只删）。
- **探测守门（硬阻断）**：执行前用 ADR-0027 的只读探测——identity 在服务器
  仍可见时拒绝执行（避免「源还在却被误脱管后另立新源」），错误文案给出两条
  正途：切维护账号 `esl upload` 同步；或由平台管理员执行 Archived/Deleted
  流程真正删除。仅 `--force` 能越过阻断，显式表态「明知源还在仍要脱管并
  另立新源」。
- **确认门槛**：交互模式确认；非交互（--no-input 或非 TTY）必须传 `--force`；
  `--force` 同时承担跳过确认与越过阻断两种强制语义。
- **清单备份**：`release.json` 改名为 `release.json.before-reset` 而非删除，
  手填的自选字段不丢；备份已存在时报错且不动 remote（破坏性前置检查）。

## Considered Options

- **不加命令，维持两步手动**：第一步无破坏性收益可讲，且漏删清单把风险留给
  重传下游。放弃。
- **一条命令删源并重传（单步重建）**：恰好是 ADR-0021 明确禁止的形态。放弃。
- **直接删除 release.json**：丢用户手填字段；改名保留成本相同。放弃。

## Consequences

- ADR-0021 的两步确认从「两次手敲 git 命令」变为「reset-source + upload 两条
  命令」，仍然是两条独立命令，不合并。
- 重置后的目录重传会产生全新 Skill ID（Deleted Skill 的 identity 不复用承诺
  在 Registry 数据存在时由服务器保证，见 CONTEXT.md 的 Deleted Skill 边界）。
