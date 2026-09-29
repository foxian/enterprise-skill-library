# install/link 按期望 Tool Link 集合对账

Status: accepted

`esl install` / `esl link` 把交互勾选和 `--tools` 统一解释为该技能在该 Skill
Store 上的**期望 Tool Link 集合**（Expected Tool Link Set），而不是增量追加
名单。对账算法：先确保期望集合内每一项（已有则幂等，缺则创建，冲突不覆盖并
记失败）；仅当集合内全部确保成功后，才删除集合外、且仍由 Tool Link Manifest
记录的 ESL 管理 Tool Link。集合内任一失败时保留旧项并让命令失败；unmanaged
的工具目录内容永不删除或覆盖。Trae 引用计数行为不变：共享物理 link 只随最后
一个引用移除。

这取代 ADR-0041 中「`install --tools` 是幂等增量操作，只确保指定工具
link，不删除未列出的工具」的决定；ADR-0041 的其余内容（作用域化 Skill
Store、单技能 link、冲突不覆盖、Trae 引用计数、`.esl-tools-manifest.json`
边界）继续有效。

配套决定：

- 规范工具 id 不变；勾选标签与人类可读输出使用展示名（Claude Code、Trae
  International 等），`claude-code` 归一为 `claude`。
- `tools remove` 的 `--tools` 仍是「要拆掉哪些」的删除名单，不是期望剩余集。
- 项目 Skill Dependency Manifest（`.skills.json`）不再声明 AI 工具；遗留
  `tools` 字段读取时忽略、写入时不再输出。
- 本机「常用工具」（Preferred Tools）只存客户端本机配置，作为首次工具挂载
  的预勾选，不进服务器、不随账号漫游、无项目级。
- `esl tools sync` 只修复已记录的 Tool Link，不按配置批量新建，也不按期望
  集合裁剪。
- `esl update` 移除 `--tools` 及其仅为「确保 link」存在的 `--force` 用途。
