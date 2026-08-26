# 02 — 离线安装、锁文件与 list 显示

**What to build:** `esl install @builtin/esl-operator`（项目级与 `--global`）从当前 CLI 包内的 Built-in Skill Package 读取并安装，不访问 ESL Server、不要求登录、不要求网络。安装记录写入 `.skills.json` 与 `.skills-lock.json`（`source: "builtin"`、`identity: "@builtin/esl-operator"`、内容校验值）；物理目录为 scope-qualified 的 `builtin_esl-operator`。安装后经现有适配引擎自动同步到已配置的 AI 工具目录（适配目录名 `builtin_esl-operator`、展示名 `builtin:esl-operator`）。`esl list` 显示来源 `builtin`。未知 `@builtin/*` 身份安装时明确报错。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `esl install @builtin/esl-operator`（项目级）安装成功，落地 `builtin_esl-operator` 目录，内容来自当前 CLI 包。
- [ ] `esl install @builtin/esl-operator --global` 安装到全局技能目录。
- [ ] 安装过程不读取 token、不要求 server 配置、不发起任何网络请求（离线可装）。
- [ ] `.skills.json` 记录 `@builtin/esl-operator` 依赖；`.skills-lock.json` 记录 `source: "builtin"`、`identity: "@builtin/esl-operator"` 与校验值。
- [ ] 安装后自动适配到已配置工具目录；适配目录名 `builtin_esl-operator`、适配后 `SKILL.md.name` 为 `builtin:esl-operator`。
- [ ] `esl list` / `esl list --json` 显示来源 `builtin`。
- [ ] `esl install @builtin/不存在的技能` 报"未知内置技能"。
- [ ] 测试通过 temp home/project 注入 fixture 内置包源目录，断言目录布局、锁内容、list 输出与适配结果（Seam 1 + 3）。