# 06 — npm lifecycle 自动同步全局内置副本

**What to build:** CLI 升级或降级时，仅当用户已显式安装过全局 `@builtin/esl-operator`，才自动把全局副本、其 ESL 管理的 Adapt Manifest 输出与锁记录同步到当前 CLI 版本。不自动首次安装；不触碰项目级副本。同步失败不阻断 CLI 的 npm 安装，剩余同步任务在下次 CLI 执行时重试。只修改 ESL 管理的全局安装记录与适配输出。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 模拟 CLI 升级：已显式安装全局内置副本时，副本与适配输出被同步到当前 CLI 版本。
- [ ] 模拟 CLI 降级：全局副本同步降级到旧 CLI 版本。
- [ ] 用户从未显式安装全局内置副本时，lifecycle 不自动安装它。
- [ ] 项目级内置副本不因 lifecycle 而变化。
- [ ] 同步失败不阻断安装成功结论，且下次 CLI 执行会重试。
- [ ] 测试直接调用 lifecycle 同步函数，断言全局副本、锁与 Adapt Manifest 状态（Seam 4）。