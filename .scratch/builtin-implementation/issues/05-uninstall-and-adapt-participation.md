# 05 — uninstall 与 adapt 显式参与

**What to build:** 已安装的 `@builtin/esl-operator` 可被正常卸载与显式适配。`esl uninstall @builtin/esl-operator` 移除技能副本、依赖条目、锁条目与各工具目录中的适配副本。`esl adapt` 把已安装的内置技能纳入显式重适配；`esl adapt --prune` 尊重内置技能的 Adapt Manifest 输出，移除已卸载内置技能的残留适配副本。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `esl uninstall @builtin/esl-operator`（项目/全局）移除副本、依赖、锁与各工具目录适配副本。
- [ ] `esl adapt` 包含已安装的内置技能（重适配刷新工具目录副本）。
- [ ] `esl adapt --prune` 清理已卸载内置技能在工具目录中的适配副本。
- [ ] 测试断言卸载后目录/锁/适配清理状态，与 prune 后的 manifest 输出（Seam 1 + adapt prior art）。