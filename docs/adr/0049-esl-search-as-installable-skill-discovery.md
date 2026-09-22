# esl search 作为可安装技能发现面

Status: accepted

消费者需要列出并查询「当前能从服务器安装的技能」，而现有 `esl search` 要求必填
query、不携带登录 token，且结果字段过瘦；`esl list` 只列本机已装，
`/api/skills/inventory` 则是含未发布技能的管理清单。我们决定**增强 `esl search`
作为唯一的消费者发现面**，不把远端浏览塞进 `esl install`，也不另造
catalog/browse 命令。

## 决策

- **职责分流**：`esl search` = 发现当前主体可见的**已发布、可安装**技能；管理向
  inventory（含未发布、managed/shared）仍走 Web/管理 API，本轮不进 CLI。
  `esl install` 保持「已知 Identity 或路径再安装」；裸 `install` 的依赖恢复语义
  另案，不占用发现入口。
- **认证**：与 `info` 对齐——尽力携带有效 Skill User Token；匿名可发现
  `public` 已发布技能，登录后附加有权的 `private`。未认证时服务端不得再静默返回
  空数组冒充「没有技能」。
- **查询**：位置参数 `[query]` 可选；缺省即浏览全部可见已发布技能。`query` 匹配
  Identity、技能描述、技能显示名与 keywords。额外硬过滤：`--namespace`、
  `--keyword`、`--visibility public|private`。匿名使用 `--visibility private` 须
  显式报错并引导登录。默认 `--limit 50`（可加大）；本轮不做真分页。
- **结果**：人类可读与 TTY 选项展示 Identity、显示名、描述、最新正式版（排除
  prerelease，与默认安装解析一致）、visibility。由 **search API 一次 enrich**
  返回，避免 CLI 对每条再打 `info`。`--json` 可含更完整字段。未发布技能不出现在
  search（与 ADR-0048 一致）。
- **TTY**：仅当 stdin/stdout 均为 TTY 且未 `--no-input`、未 `--json` 时启用
  `@inquirer/prompts`。选技能列表中「调整筛选…」视觉置顶，但 `default` 高亮第一条
  技能；末项为「退出」。选中技能后再选「查看详情 / 安装 / 取消」：详情或取消回到
  列表；安装须先回显完整 `esl install …` 并确认后再执行（可进入既有 tools 选择），
  成功后退出。0 条结果不进入空技能列表，仅提供调整筛选或退出。本轮不为 search
  接入 `--agent-interaction`；Agent 使用 `--json` 后自行调用 `info`/`install`。

## 考虑过的方案

- **新命令 catalog/browse 或 `list --remote`**：与已有 search 语义分裂；`list` 已占用本机 Store。
- **把远端目录 TTY 挂在 `install`**：发现与安装耦合；且与「已知目标再装」及未来裸
  install 恢复依赖冲突。
- **search 内联静默安装或选完只打印建议命令**：前者破坏只读默契，后者失去安装捷径；
  折中为确认后执行。
- **CLI N+1 调 info / 第一版不展示显示名与版本**：字段与延迟不可接受；enrich search API。
- **会话内不做再筛选、或每次先强制步骤 0**：前者不满足「界面里改组织/可见性」；
  后者打断已用旗标筛好的主路径。改为置顶「调整筛选…」+ 默认焦点在第一条技能。

## 后果

- Server `/api/skills/search` 与 DB 检索需支持空 query、namespace/keyword/visibility/
  limit，以及显示名、最新正式版、keywords 等目录字段；权限过滤保持
  public ∪ 有权 private。
- CLI `search`、operator skill（`skills/esl-operator`）与 usage 文档须与本 ADR 锁步
  （ADR-0008）；`--json` / 非交互路径不得弹 inquirer，也不得执行安装。
