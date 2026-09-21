# 使用单一平台组织托管源码并发布命名空间化安装包

ESL 初始化时配置唯一且运行后不可变的 Platform Organization，所有服务器托管技能均使用该组织作为稳定 Namespace（即它们 Skill Identity `@scope/skill-name` 中的 scope 段；按 ADR-0009，Scope 是机械层概念，Namespace 是 Scope 中由 Platform Organization 占用的保留段，带治理语义），且所有 Skill User 都可在其中创建源码仓库。该组织只在首次 Bootstrap 设置；后续没有常规 CLI 或 API 变更入口，配置错误或组织迁移必须由平台管理员执行显式的数据迁移或重部署。首次 `upload` 创建带 `sk_` 前缀 ULID 的 Skill ID 和服务器 Git 仓库；即使尚未产生 Skill Release，该 Skill ID 也持续存在。源码以 `SKILL.md` 和 `release.json` 为发布输入，不在源码中维护 `skill.json`；`release.json` 随源码 Git 管理并声明 `schemaVersion`、许可证、关键词、兼容性和技能依赖，但不包含版本号。首次上传只新增名为 `esl` 的 Git remote，不覆盖本地已有的 `origin`；后续源码修改由 Maintainer 提交并推送至该仓库，`upload` 不覆盖已有源码。Server-hosted Skill Source 与 Skill Release 分离：所有已登录用户可下载未发布源码，但只有 Maintainer 可修改；未发布源码不可安装。Git push 只同步源码，不创建 Skill Release；`publish` 必须在源码 Git 工作区执行，要求工作区干净、当前 `HEAD` 已存在且等于 `esl/main`，不隐式 push 源码分支，而是以显式 SemVer 发布该 `HEAD`。第一版不支持指定任意历史 commit。发布由 Maintainer 从该明确源码提交创建不可变、不可覆盖或删除的 Published Skill Package，发布包默认面向已登录用户消费，远程安装只消费该包，并将其存为 `scope_skill-name` 目录（按 ADR-0009 的 adapt 命名规则，scope 即其 Namespace）；依赖声明仍使用 `@scope/skill-name`。Release 绑定 Skill ID、SemVer、源码 commit 和发布包 checksum；发布时解析并保存不可变的 Release Dependency Lock，循环依赖被拒绝。Release 创建成功后由服务器创建并推送 annotated `v<SemVer>` Release Tag；Tag 只用于在 Git 历史中定位源码，不是 Release 的事实来源，Tag push 失败也不回滚成功的 Release，后续只可在 commit 一致时修复缺失 Tag。发布只完成通用 scope（Namespace）命名，客户端仍负责将安装包适配到各 AI 工具目录（按 ADR-0009，adapt 目录名为 `scope_skill-name`、展示名为 `scope:skill-name`）。技能改名必须经显式管理员流程，保持 Skill ID 不变，并由 ESL 永久解析旧 Identity 到新 Identity，同时协调 Git 仓库改名；按 ADR-0009，Skill Rename 只改短名，不改 scope 段（scope 段由 Platform Organization 锁定）。ESL Platform Administrator 对失联、停用或无人维护的技能拥有治理兜底权。服务器以不可变 Skill ID 跟踪技能，使 Owner、维护者、用户身份和 Git 地址的变化不影响技能追溯。
所有已登录 Skill User 都可以首次 `upload`，上传者成为初始 Maintainer；上传后的默认状态为 Active Unreleased Skill Source。已发布技能的源码仍可继续提交，但只有新的 Skill Release 才会影响 `install` 和 `update`。Archived Skill 只能由 ESL Platform Administrator 恢复。

普通 Git push 修改 `SKILL.md.name` 时，服务器端校验必须拒绝该提交并提示使用显式重命名流程；重命名流程负责同步 `SKILL.md`、服务器身份、Git 仓库名和旧名称重定向。源码不保存 `skill.json`；服务器只在生成 Published Skill Package 时创建安装包清单。

未发布技能默认保持可协作的活动草稿状态，不会因为尚未发布而自动标记为 Archived。只有技能被明确停用或废弃时，才标记为 Archived；Archived 技能不出现在默认搜索结果，也不能接受新的源码修改或创建新的 Skill Release，但历史发布包、安装记录和重定向继续保留。

该规则同样适用于从未发布的 Archived 技能。初期不提供任何物理删除入口；未来如需释放存储，必须另行设计带审计、备份和恢复窗口的受控清理流程。

已安装技能在更新时通过 Skill ID 识别重命名：客户端自动迁移本地安装目录、依赖键、锁文件和适配输出，并提示用户新的 Skill Identity。固定旧 Release 的安装不迁移。

旧 Identity 的普通安装请求不自动跳转到新 Identity，而是提示用户迁移；用户显式指定历史 Release 时仍可安装旧 Published Skill Package。旧 Identity 永久保留为重定向，不得被其他技能复用。`source` 默认检出源码仓库当前 `main`，复现历史源码必须显式指定 Git ref 或 Skill Release。
