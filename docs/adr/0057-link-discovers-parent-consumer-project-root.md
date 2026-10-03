# 站在 Local Skill Source 时，项目级 `link`/`unlink` 只认上一级 Consumer Project Root

Status: accepted

`esl link` 若把 cwd 既当 Local Skill Source 又当项目根，项目级 Skill Store 会落在源码内部，Skill Source Link 形成自指环。我们决定：仅 `link` 与 `unlink` 在「项目级、且默认项目根会把 Store 嵌进源码」时，把 Consumer Project Root 定为技能目录的上一级（只看一层，不向祖先搜索）。上一级已有 Skill Dependency Manifest（`.skills.json`）或 Skill Store（`.eslib/`）则静默采用；否则若存在 ESL 项目级工具点目录（与 Tool Link 矩阵锁死：`.claude`、`.codex`、`.cursor`、`.trae`、`.workbuddy`、`.opencode`、`.hermes`）则视为候选，须确认后才用；再否则三选一（初始化上一级 / 指定目录 / 改全局），非交互不猜。全局 `-C` 先 chdir，再对 *新 cwd* 做上述判断。`install`、`update`、`uninstall`、`list`、`tools` 不探测：cwd 即项目根；站在技能源码里时 `list`/`tools`/`uninstall` 只提示去上一级或 `-C ..`，`install`/`update` 拒绝在无 Manifest/Store 的技能目录创建嵌套 Store。这修正了「CLI 绝不从技能目录寻找项目根」的 unlink 规格，但并不把查找范围扩大到任意祖先。

拒绝的备选：站在源码里默认全局 Store（项目级 link 会装错作用域）；从技能目录一直向上走到根（祖先目录误匹配）；把技能自己当成项目根（自指环）；为项目根新开 `--project`（现有 `-C` + 上一级规则已够）；`list`/`tools`/`install` 也自动看上一级（这些命令的主语是 Store，不是当前技能）。
