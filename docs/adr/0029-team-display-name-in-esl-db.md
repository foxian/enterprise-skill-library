# 团队显示名独立于团队标识名，存于 ESL 数据库

Status: accepted

修订 ADR-0026 的团队模型：组织团队拆成两个概念——**团队标识名**（Team
Identifier，机器名，小写字母/数字/连字符，唯一键，即 Gitea Team Name）与
**团队显示名**（Team Display Name，ESL 侧可选中文展示名，非唯一，未设置回退
标识名）。我们决定：**显示名只存 ESL 数据库，不写入 Gitea**——它是纯展示
概念，不参与唯一性、默认团队识别或授权判定；Gitea 团队保持纯 ASCII，显示名
只在 ESL 控制台可见。

## 背景与动因

1. 组织团队名此前是单一字符串，直接映射 Gitea Team Name。团队管理页、权限
   面板等界面展示的就是这个机器名，无法用中文（Gitea Web UI 表单以
   `AlphaDashDot` 限制团队名，仅 API 层放行；但 ESL 不需要中文团队标识名）。
2. 诉求是"团队在界面上用中文"，而非"团队标识符本身是中文"。后者会引入
   Gitea 后台「看得到却动不了」（改名被表单拒绝）的裂脑，且把机器名与展示
   语义混在同一个字段里。

## 核心决策

### 1. 标识名与显示名解耦

- **团队标识名**：维持现有约束 `[a-z0-9-]`，是团队唯一键与授权对象，与
  Gitea Team Name 一致。默认团队识别、权限面板授权值、data-test 定位均以
  它为准。
- **团队显示名**：ESL 侧字段，可选、可重复、允许中文；未设置时回退显示
  标识名。不参与任何判定逻辑。见 CONTEXT.md 的「团队标识名 / 团队显示名」。

### 2. 显示名只存 ESL 数据库（不写 Gitea）

- 显示名挂在 `(org_name, gitea_team_id)` 上，键按 **Gitea team ID** 而非
  团队名——标识名改名（Gitea 挂载按 ID 引用，ADR-0026）不丢显示名，与
  "改名不断授权"同一语义。
- 不写入 Gitea Team `description`：显示名是展示层概念，Gitea 是管道而非
  产品界面；避免「有人直接改 Gitea Description → ESL 分叉」的双写问题，也
  避免把纯展示字段绑到跨系统可达性上。
- 后果是明确的边界：**Gitea 后台看到的中文团队名一律为标识名（ASCII）**，
  中文只存在于 ESL 控制台。这是有意的取舍，不是缺陷。

### 3. 默认团队显示名数据化

- 默认团队的显示名（如 `system-admins` → 系统管理团队）从前端硬编码
  `DEFAULT_TEAM_LABELS` 迁入数据：组织初始化（org-init）播种，存量组织
  由迁移回填。前端 `teamDisplayName` 统一为 `display_name ?? name`。
- 三个全员默认团队（all-readers/all-writers/all-managers）当前没有显示名
  消费点（其授权由组织共享级别承载、不列于团队管理页），播种显示名仅为
  数据统一，不产生可见变化。

## Considered Options

- **B. 复用 Gitea Team `description`**：显示名=Description，ESL 读穿、改名
  PATCH 写回，Gitea 后台也能显示中文。放弃——ESL 目前不读 Description，
  需扩展 `GiteaTeam` 与 create/list 契约；且 Description 在 Gitea 后台可
  直接编辑，会引入事实源分叉。
- **C. ESL DB 为主 + 镜像到 Description**：双写，分叉风险最高。放弃。
- **显示名按团队名键挂**：标识名改名会使显示名漂移（键跟着变）。放弃。

## Consequences

- ESL DB 新增团队显示名表：`(org_name, gitea_team_id, display_name)`。
- API 契约：`GET /api/orgs/teams` 响应新增 `display_name`；`POST`/`PATCH`
  `/api/orgs/teams*` body 接受可选 `display_name`（独立于标识名校验：可选、
  去空格、非空、限长）。
- 前端消费点改为显示名：TeamsView 团队管理列表**同时展示显示名与标识名两列**
  （标识名列即 Gitea 团队名的可视化）；SkillPermissionsPanel 授权下拉与已授权
  标签用显示名（未设置回退标识名），下拉 value 与 `remove_team` 请求体仍用
  标识名。
- 存量迁移：自定义团队无显示名则回退标识名，无回归；`system-admins` 必须
  回填，否则会从「系统管理团队」回退成「system-admins」。
- Gitea 侧零改动：团队名、挂载、授权逻辑全部不变。
