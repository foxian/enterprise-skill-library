# 作用域化技能源与单技能工具链接

Status: accepted

ESL 原先把技能复制进 `.skills` / `.skill-library`，再由 adapt 复制到各 AI 工具目录；在同时支持项目级、全局级和多个工具后，副本归属、更新传播与安全删除边界都会变得模糊。我们决定改为作用域化的 Skill Store：项目使用 `<project>/.eslib/skills`，全局使用 `~/.eslib/skills`，作为 ESL 安装技能源的唯一本地真相；技能源按 npm 风格使用 `@scope/skill-name` 目录布局，例如 `.eslib/skills/@acme/code-review`。每个被选择的 AI 工具目录只通过一个使用安全目录名 `scope_skill-name` 的单技能 link 指向对应源，而不是复制内容或链接整个 skills 根目录。Windows 优先使用 directory junction，类 Unix 使用 symlink；创建失败不回退为复制。

项目根目录继续保留 `.skills.json` 与 `.skills-lock.json` 并提交到 Git，分别作为项目直接依赖声明和精确解析锁；`.eslib/` 是本机生成状态并保持 gitignore。每个 Skill Store 维护自己的 `.esl-install-manifest.json` 与 `.esl-tools-manifest.json`，不使用旧 `.esl-adapt-manifest.json`，也不把项目状态写入用户全局 manifest。`update` 只更新 Store 内源并检查已登记 link，正常 link 自动看到新内容；`install --tools` 是幂等增量操作，只确保指定工具 link，不删除未列出的工具；`uninstall` 删除源和全部 ESL 管理 link，`tools remove` 只删除指定管理 link。冲突永不覆盖，多工具允许部分成功。Trae 国际版与国内版在项目级共享 `.trae/skills` 时，同一物理 link 由工具清单引用计数保护，最后一个引用移除时才删除。
