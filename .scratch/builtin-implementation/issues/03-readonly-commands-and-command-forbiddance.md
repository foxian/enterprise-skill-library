# 03 — 只读命令与命令禁集

**What to build:** 内置技能在命令面的非安装行为。`esl use` 与 `esl info` 支持 `@builtin/esl-operator`（从 CLI 包读元数据/内容，不联网、不登录）。`publish`、`upload`、`source`、`rename`、`version` 对 `@builtin/*` 身份明确拒绝，提示内置技能不可作为 Server-hosted 技能发布/上传/拉源码/改名/改版本。`esl search` 永不返回任何 `@builtin/*`。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `esl use @builtin/esl-operator` 输出内置技能 Prompt 文本，可管道给 agent，不安装、不改项目、不联网、不登录。
- [ ] `esl info @builtin/esl-operator [--json]` 输出内置技能元数据（含与 CLI 一致的版本）。
- [ ] `publish` / `upload` / `source` / `rename` / `version` 对 `@builtin/*` 身份拒绝并给出清晰信息。
- [ ] `esl search <query>` 结果不含任何 `@builtin/*`。
- [ ] 测试断言上述命令输出/报错信息（Seam 1 + 命令级 prior art）。