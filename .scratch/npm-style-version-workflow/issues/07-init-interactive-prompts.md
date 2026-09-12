# 07 — `esl init` 交互问答与非交互模板双形态

**What to build:** `esl init` 在终端里逐项问答（npm init 式），管道 / `--no-input` 环境回落为固定模板——两种形态都保留，脚本友好性不退化。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] TTY 环境下逐项询问 description、license、keywords，每项带默认值，回车接受默认。
- [ ] 非 TTY 或 `--no-input` 时跳过问答，直接写模板（保持现有行为与输出）。
- [ ] `--license` 等显式旗标存在时不再询问对应项（旗标优先级高于问答）。
- [ ] scaffold 的 `release.json` 带 `version: "0.1.0"`（见 01 的最小清单）。
- [ ] `SKILL.md` 模板不含 `version` 字段。
- [ ] 问答结果写入后仍走 `validateSkillSourceDirectory` 校验，校验失败时报错可读。
- [ ] 现有 `--directory` / 目录已存在报错等行为不变。
- [ ] 测试覆盖：非 TTY 路径（CI 主路径）、TTY 问答路径（注入 stdin 模拟）、旗标优先、默认值接受。
