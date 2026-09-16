# 分级技能删除、Deleting Workflow 与身份释放

Status: accepted

## Context

ADR-0014 引入了整技能物理删除，但它的假设已经不再匹配当前产品与权限模型：

- 删除入口只在服务端存在，CLI 入口已按 issue #10 移除，Web 也没有完整生命周期入口。
- Restore 仍假设只有平台管理员能执行，且总是恢复为 `active-unreleased`。
- 旧决策认为删除后 Identity 名字不可复用，这与“彻底清理错误注册/测试残留并释放名字”的治理诉求冲突。
- best-effort 删除会让 Gitea、Published Skill Package 和 DB 处于不一致状态，也无法可靠重试。

## Decision

### 两阶段生命周期

整技能删除必须先 Archive，再 Delete。Delete 只接受 `archived` 或 `delete_failed` 状态。Archive 继续由该技能 `manage` 权限执行；Restore 是 Archive 的逆操作。

Restore 状态规则：

- 从未发布：回到 `active-unreleased`。
- 曾经发布过任何 Skill Release：回到 `active-published`。

“曾经发布”以 `skill_releases` 是否存在行为准，包括单版本删除留下的 tombstone；不能用当前可见 release 数或技能状态推断。

### 分级 Delete / Restore 权限

Delete 与 Restore 使用同一权限模型：

| 技能类型 | 允许者 |
| --- | --- |
| 从未发布 | 拥有该技能 `manage` 权限的人 |
| 曾发布组织技能 | 平台管理员，或该组织 Owners 团队中的所有者成员 |
| 曾发布个人技能 | 平台管理员，或技能 owner / 创建者 |

组织管理成员和普通 `manage` 授权者不能删除或恢复已发布整技能。平台管理员始终兜底。

### 依赖方

依赖方不阻断整技能删除。但删除前必须通过 delete-context 返回完整依赖方列表，供 UI 展示；审计记录也要保存同一列表。依赖方在删除后可能安装失败，这是治理动作已接受的后果。

### Deleting Workflow

不做 best-effort 删除。Delete 请求按以下流程执行：

1. 校验状态、身份确认和必填原因，进入 `deleting`。
2. 删除 Gitea repo。
3. 删除 `packageRoot/<skillId>` 下的 Published Skill Package。
4. 在 DB 事务中插入审计并删除 releases、versions、tags、redirects 和 skill 记录。

第 2/3 步失败时技能进入 `delete_failed`，保存错误信息和原始请求者/原因；可从 Web 用同一确认流程重试。第 4 步是数据库事务，不允许出现“技能已删但审计未写”的状态。

### 审计与名字释放

删除审计保存在独立的 `skill_deletion_audits` 表，记录 Skill ID、完整名、scope、short name、删除人、原因、被移除 release 数和依赖方列表。表不设指向 `skills` 的外键，审计在技能删除后仍然存在。首版只落库，不提供查询 UI。

删除成功后完整 Skill Identity 名字释放。同名可重新登记为新 Skill，并生成新的 Skill ID；新技能与旧技能没有连续性。这有意修订 ADR-0014 的“不可复用”表述，也修订 ADR-0007 中依赖旧 Identity 连续性的相关假设。

### 入口

整技能 Archive/Restore/Delete 只在 Web 共用的 SkillManagePanel 暴露。Delete 必须先展示依赖方和 release 数，要求填写非空原因，并输入完整 Skill Identity 确认。不恢复 `esl delete` CLI；`esl reset-source` 的错误指引只描述该分级权限，不提供删除命令。

## Consequences

- 曾发布技能的 Restore 不再错误回到未发布状态。
- 外部资产失败会保留技能记录并明确呈现错误，不再产生静默孤儿。
- 同名重建释放了治理空间，但旧 Skill ID、Release 历史和 redirects 不会延续。
- 删除期间依赖方没有冻结机制；删除动作会立即释放名字并移除安装产物。
- 审计是事后追责与治理记录来源，而不是阻止删除的软引用。

## Alternatives Considered

- **维持平台管理员唯一删除权**：简化权限，但把未发布错误注册的清理强加给平台管理员，成本过高；已拒绝。
- **依赖方阻断删除**：更保守，但治理者无法清理恶意或废弃的依赖根；已拒绝，改为强制展示依赖方。
- **异步后台删除队列**：未来可扩展，但当前量级同步删除加 `delete_failed` 重试已足够；本 ADR 的状态模型不阻碍后续引入队列。
