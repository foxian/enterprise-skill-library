# 04 — update 刷新

**What to build:** 已安装的 `@builtin/esl-operator` 可通过更新刷新到当前 CLI 包版本。`esl update @builtin/esl-operator`（项目级）刷新项目副本与锁为当前 CLI 版本；`esl update --global` 刷新全局副本；无参数 `esl update` 覆盖已安装的项目级内置技能。项目级内置副本不随 CLI 升级自动同步，必须由用户显式更新，保证项目可复现。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `esl update @builtin/esl-operator` 把项目副本刷新为当前 CLI 包版本，并更新锁记录。
- [ ] `esl update --global` 刷新全局内置副本为当前 CLI 版本。
- [ ] 无参数 `esl update` 覆盖已安装的项目级内置技能；未安装时行为与普通技能一致。
- [ ] CLI 升级本身不触发项目级内置副本的自动同步（保持可复现）。
- [ ] 测试断言更新后副本内容、锁版本与工具目录适配输出（Seam 1）。