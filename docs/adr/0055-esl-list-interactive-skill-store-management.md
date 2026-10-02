# `esl list` 作为本机 Skill Store 交互管理入口

Status: accepted

`esl list`（及别名 `ls`）从「只打印已装技能瘦清单」升级为**当前 Skill Store
的本机管理入口**：在 TTY 且未禁用输入时，裸命令进入两级交互（先选技能，再看
详情并执行动作）；`--json`、`--no-input` 与非 TTY 环境保持只读。管理台按技能
聚合展示本机真相（Install Manifest、Skill Source Link 源路径、该技能的 Tool
Link 及状态），并允许在确认后执行单技能 `update`、按 source 分流的 `unlink` /
`uninstall`，以及对该技能做期望 Tool Link 集合对账（语义同 ADR-0054）。它不
取代 `esl tools *`：按工具过滤、managed/unmanaged/status 排障与 `tools sync`
仍归 Tool Link 专用面。第一版不为 `list` 管理流实现 Agent Interaction；Agent
应 `list --json` 后改调专用命令。

拒绝的备选：新建并行的 `esl manage`（多一个入口，list 仍盲）；把日常改 Tool
Link 的主路径并进 `tools list`（轴是工具而非技能）；交互第一级塞满工具名
（有详情层后占空间）；详情拉远程 `esl info` 或展示 ESL Server 根地址（管理台
回答本机状态，不混成技能主页）。

配套决定：

- 交互第一级展示技能显示名、Skill Identity、version、source；不展示工具列表。
- 只读人类打印可与第一级不一致：一行附带已链接工具摘要，因无第二级可点。
- `--json` 在既有 name/version/source 上增加可选 displayName、tools 数组，以及
  source=link 时的 linkSourcePath；不访问网络。
- 详情对 source=link 必显链接源路径；不展示 Server 根地址；默认不展示
  registry 的 package URL。
- 变更前一律确认；uninstall/unlink 成功后回列表并刷新，update 与 Tool Link
  对账成功后留在详情并刷新。
- builtin 等来源隐藏不适用动作（例如无 unlink），不点了再报错。
