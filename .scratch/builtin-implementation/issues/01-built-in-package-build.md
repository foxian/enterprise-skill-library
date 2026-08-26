# 01 — Built-in Skill Package 构建

**What to build:** CLI 构建时从唯一可编辑源码 `skills/esl-operator/` 生成 Built-in Skill Package，并随 npm 包发布。生成的包含 `SKILL.md`、支持文件（references 等）、`skill.json` 和内容校验元数据；`skill.json` 的 SemVer（含 prerelease 标识）必须严格等于当前 `@esl/cli` 的版本。构建与 npm 发布前校验内置包内容、版本一致性、checksum 与 npm 包包含性；版本不一致则构建失败。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 对 `skills/esl-operator/` 运行构建能产出 Built-in Skill Package，内含 `SKILL.md`、支持文件、`skill.json` 与内容校验元数据。
- [ ] 生成的 `skill.json` 使用安装身份 `@builtin/esl-operator`，`name` 保持短名。
- [ ] 生成的 `skill.json` 版本严格等于当前 `@esl/cli` 的完整 SemVer（含 prerelease）；不一致时构建失败并给出明确错误。
- [ ] 构建产物包含内容校验值，可检测安装时内容损坏。
- [ ] npm 包包含构建出的 built-in 资源，安装后的 CLI 能从中读取。
- [ ] 用 fixture 技能目录运行打包逻辑的测试：断言 `skill.json` 版本、files 清单与校验值正确；断言版本不匹配时构建失败（Seam 2）。