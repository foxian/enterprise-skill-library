# #199 技能目录：开工前技术核查

- 关联：Spec #200、本票 #201（[T1] 开工前技术核查与域文档基线）
- 分支：`feat/199-skill-catalog`，基线 commit `1e032f7`
- 核查范围：只读代码与迁移机制；本票不写功能代码、不改 API、不改 Web、不改数据库
- 结论口径：每节先给结论，再列 `path:line` 证据，最后给后续票（T2–T7）的直接指令

## 0. 总览

| # | 核查项 | 结论 | 主要依据 |
|---|---|---|---|
| 1 | 三桶归类与来源主体名 | **go**（附一项来源口径确认，见 §1.5） | 组织隶属、可见性、可读权限、命名空间均有现成数据源；授权执行人不落库 |
| 2 | 漏斗事件存储与上报 | 可落：新增独立表 + Repository + 鉴权/可选鉴权路由 | ADR-0067 的下载日志模式、`databaseSchema` 启动建表、`ensureColumn` 迁移 |
| 3 | 共用详情页现状 | 现为公开壳独立路由；三态未统一；归档详情未拦截；返回出口写死 | `/skills/:scope/:skillName`、`GET /api/skills/*` |
| 4 | 公开目录排序/分页/搜索 | 无显式排序（实际插入顺序）、无分页（单次 `limit` 默认 50）、搜索字段为名称/描述/显示名/keywords | `searchSkills`、`/api/skills/search`、`CatalogView` |
| 5 | 最新稳定版与下载量 | 均有现成查询，可直接复用 | `highestStableVersion`、`DownloadLogRepository`、`withDownloadCounts` |
| 6 | metadata keywords | 存在：Release Manifest 必填数组，搜索与详情均已消费 | `ReleaseManifestSchema`、`releaseKeywords` |
| 7 | Archived 状态 | 表中有 `archived`；发现查询排除，但消费详情不排除 | `archiveSkill`、`searchSkills`、详情路由 |
| 8 | 测试惯例与 `ESL_AUTO_SEED` | 各层惯例清晰；现有 seed 不足，T7 需新增可重复验收 seed | `config.ts`、`app.ts`、`seed.ts`、各层测试 |

**一句话 go/no-go：三桶归类与来源标注在现有模型下可实现，go；不需要缩减为两桶。唯一需要 PM 确认的是「个人 private 技能的授权方显示名」只能取该技能个人命名空间主体（系统不记录授权执行人），详见 §1.5 与 §11。**

---

## 1. 三桶归类与来源主体名的数据可得性

### 1.1 结论

**go。** 三桶互斥归类和来源主体名所需的数据在现有授权 / 组织 / 团队 / 成员模型下齐全：

- 技能归属命名空间：`skills.scope`（组织名或用户名）
- 技能可见性：`skills.visibility`（`private|public|anonymous`）
- 用户所属组织：`GiteaService.listUserOrgs(username)`
- 请求时刻可读性：`getAccessLevel`（覆盖 owner、Maintainer、组织管理成员、全组织档位团队、常设/自定义团队投影、成员协作者、public/anonymous 读基线）
- 归属类型：命名空间是否为活跃租户组织
- 来源主体：组织技能取组织名（即 `scope`）；个人技能取个人命名空间主体（即 `scope`）

**不需要降级为两桶。** 唯一的数据缺口不是归类，而是「授权动作执行人」：成员授权以 Git Backend 仓库协作者表达，没有 `granted_by` 字段。详见 §1.5。

### 1.2 证据

- 技能归属与可见性字段：`packages/server/src/db/schema.ts:2-22`（`scope` 第 5 行、`visibility` 第 13 行、`status` 第 14 行）
- 上传时确定 `scope`，组织命名空间要求上传者是组织成员：`packages/server/src/routes/skills.ts:236-260`
- `owner` 记录的是创建者而非命名空间所有者：`packages/server/src/routes/skills.ts:297-309`（`owner: user.username` 第 304 行）
- 用户所属组织：`packages/server/src/services/gitea.ts:612-634`
- 组织隶属与身份派生：`packages/server/src/services/organization-membership.ts:71-89`
- 请求时刻读取权限：`packages/server/src/services/skill-access.ts:25-66`
  - 创建者 / Maintainer / 平台管理员 / 组织管理成员：`skill-access.ts:31-35`
  - 登录用户 public/anonymous 读基线：`skill-access.ts:39` + `packages/core/src/skill/visibility.ts:19-21`
  - 团队投影与成员协作者：`skill-access.ts:44-60`
- 当前发现接口已经是「public/anonymous ∪ 有权 private」：`packages/server/src/routes/skills.ts:381-390`
- 组织命名空间判定（现有管理面同款）：`packages/server/src/routes/skills.ts:182-183`
- 组织技能成员授权对象限于组织成员：`docs/adr/0065-skill-member-grant-boundary-and-candidate-contract.md:9`；个人技能向全平台用户授权：同文件第 10 行
- 组织 public/private 与团队授权的模型：`docs/adr/0032-npm-style-identity-flat-namespace-pool-and-authoritative-release-name.md`、`docs/adr/0037-skill-permission-is-per-skill-team-projection.md:14-23`、`docs/adr/0038-organization-managing-member-boundary.md:5-11`
- 术语边界：`GLOSSARY.md:518-530`（技能可见性）、`GLOSSARY.md:574-585`（个人技能 / 组织技能）、`GLOSSARY.md:569-572`（技能成员授权）

### 1.3 可直接实现的归桶规则（T2 / T3）

对「当前请求时刻已确认可安装的已发布技能」逐条归类，**先判命名空间，再判可见性**，保证互斥且覆盖全集：

```text
canInstall = 已发布（有 release、status 为 published/active-published）
          且 (匿名: visibility === anonymous
              | 登录: visibility ∈ {public, anonymous} 或 getAccessLevel !== none)

if (!canInstall) 不进入目录

if (scope ∈ 我的组织集合):
    bucket = org            // 含该组织 public、private、anonymous
else if (visibility === private):
    bucket = granted        // 只可能是个人命名空间 private
else:
    bucket = platform       // 其他组织 public/anonymous + 本人个人 public/anonymous
```

要点：

1. **组织 public 进 org**，不是 platform。这是「就近」轴的直接结果，也是 spec 验收 4 的明确要求。
2. **本人个人 public 进 platform**；**本人个人 private 进 granted**，卡片来源显示「我的技能」。
3. 多组织扁平：只取 `scope` 集合，不按组织分组；卡片额外给组织名。
4. 组织 private 能被当前用户读到时，按 ADR-0065 他必然是该组织成员，因此 `scope ∈ 我的组织集合` 成立；若因脏数据出现「可读但不在我的组织集合」，属于不变量破坏，T2 应 **fail closed 排除并记录诊断日志**，不得猜成 `granted` 或 `platform`。
   - 已知存量路径：`getAccessLevel` 对 `skill.owner` / `skill.maintainers` 直接给 manage（`skill-access.ts:31`），而 `removeMemberFromOrganization` 离组时只清协作者与团队、不清 `owner` / `maintainers_json`（`organization-membership.ts:190-210`）。因此离组的前创建者/前 Maintainer 仍可能读到组织 private 技能，但已不在该组织集合。T2 按上面的 fail closed 处理；根因清理（离组时维护 owner/maintainers）应另开票，不在本 spec 范围。
5. `all = org ∪ granted ∪ platform`，因为每个条目恰好落入一个分支。

### 1.4 来源主体与归属类型（T2 / T3）

| 字段 | 数据来源 | 说明 |
|---|---|---|
| `namespaceKind` | `tenantOrganizationRepository.get(scope)?.status === 'active'` | `organization` / `personal`；查不到租户记录时按 `personal` 渲染并记录诊断，不阻断目录（桶已先按组织集合判定） |
| `namespaceName` | `scope` | 组织名或用户名；ESL 没有独立的组织/用户展示名字段 |
| `source.kind` | 由桶与登录主体推导 | `organization` / `person` / `self`（仅本人 private） |
| `source.name` | 组织技能取 `scope`；个人技能取 `scope` | 见 §1.5 的口径限制 |
| `visibilityLabel` | `visibility` | Web 只渲染「公开 / 私有」两态；`anonymous` 对登录主体显示为公开 |

说明：ESL 的 `GiteaUser` 只有 `id/username/email`，没有 `full_name`（`packages/server/src/services/gitea.ts:4-8`）；`GiteaOrg` 只有 `name`（同文件第 38-42 行）。因此「显示名」在本模型里就是用户名 / 组织名，不需要新增数据。

### 1.5 唯一的数据缺口：授权执行人不落库

- 成员授权在 Git Backend 表现为仓库协作者，权限矩阵只读取 `username + permission`，没有授权人字段：`packages/server/src/routes/skills.ts:1704-1715`
- SQLite schema 只有团队授权表 `skill_team_grants`，没有成员授权表或授权审计表：`packages/server/src/db/schema.ts:121-132`
- ADR-0037 明确「单个用户授权继续使用技能仓库直接协作者」：`docs/adr/0037-skill-permission-is-per-skill-team-projection.md:22`

因此「他人直接授权给本人的 private 个人技能」无法得知是哪位 Maintainer 点的授权。**建议口径（本审计采用的 go 前提）**：卡片来源显示该技能所属的个人命名空间主体（`scope`），语义是「这个技能属于谁、由谁授权」，足以回答用户「我凭什么能看到」。本人 private 显示「我的技能」。

若 PM 要求精确到「授权执行人」，则该项 **no-go**，需要新增授权审计字段/表（并回填），不建议放入 V1；届时回 PM 确认，而不是研发自行把来源行删掉。此确认项列入 §11。

### 1.6 对后续票的指令

- **T2**：不要使用 `deriveOrganizations` 做目录归桶——它会为每个组织额外查 `listTeams`（`organization-membership.ts:71-89`）。目录只需要 `giteaService.listUserOrgs(username)` 得到的组织名集合，一次请求算一次。
- **T2**：登录主体的候选集必须复用「已发布 + 可读」判定；public/anonymous 直接短路为可读，**只有 private 才调用 `getAccessLevel`**，避免当前 `getAccessLevel` 对 public 也去查团队的额外开销（`skill-access.ts:39-60`）。
- **T2**：权限查询异常按 fail closed 排除该条并记录诊断日志，不能让整个目录 500。
- **T2**：新端点若挂在 `/api/catalog/...`，必须同步扩展 `app.ts:257-289` 的组织门禁（当前只匹配 `/api/skills` 前缀）；否则冻结/删除中的组织技能会绕过「组织未激活」拦截。更稳妥的做法是把目录查询挂在 `/api/skills/` 前缀下，或把门禁抽成覆盖两个前缀的共享 preHandler。
- **T3**：归桶函数放 `packages/core`，输入是「已经过服务端鉴权过滤的候选 + 主体组织集合 + 命名空间类型」，输出 `all|platform|org|granted` 与来源字段；服务端不复制一套 if/else。
- **T3**：不可读条目在进入 core 之前就被排除；core 的测试以「给定候选，断言桶与来源」为主，不反向依赖 Gitea。

---

## 2. 漏斗事件：存储挂载点、迁移方式与上报 API 形态

### 2.1 结论

可以完全照搬「下载日志」的服务器侧事件模式，但**新建独立表与独立 Repository/路由**，不要复用 `download_logs`：

- 存储：`catalog_funnel_events` 新表，追加到 `databaseSchema` 即可；启动时 `db.exec(databaseSchema)` 会自动为旧库建表，无需额外迁移框架。
- Repository：按 `DownloadLogRepository` 的预编译语句 + 事务模式实现。
- 上报：新增 `POST /api/catalog/events`，**可选登录**（公开目录的匿名流量也要入库），服务端补 `subject_user_id` 与 `occurred_at`，客户端不可信字段一律忽略。
- 不需要统计 UI；V1 用 Repository 查询/导出。

### 2.2 证据

- 建表与「迁移」机制：`packages/server/src/db/database.ts:62-84`（每次启动执行 `databaseSchema`、按需 `ensureColumn`）、`database.ts:135-140`（`ALTER TABLE ADD COLUMN`）
- 下载日志表结构：`packages/server/src/db/schema.ts:206-252`
- 下载日志 Repository 模式（预编译 + 事务 + 聚合）：`packages/server/src/db/database.ts:874-1017`
- 事件写入热路径：`packages/server/src/routes/skills.ts:130-159`（`recordDownload`）、`skills.ts:1270-1280`（成功发放才计数）
- 管理端查询与鉴权：`packages/server/src/routes/download-log-admin.ts:21-37`
- 应用装配：`packages/server/src/app.ts:153`（实例化）、`app.ts:162-186`（保留期清理）、`app.ts:349-364`（路由注册）
- 鉴权函数：`packages/server/src/routes/skills.ts:1825-1843`（当前是 `skills.ts` 内部函数，未导出）

### 2.3 建议落点（T6 直接采用）

**表**（追加到 `databaseSchema`，字段与 spec 最小载荷一一对应）：

```sql
CREATE TABLE IF NOT EXISTS catalog_funnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_user_id TEXT,          -- Gitea 数值 id 字符串；匿名/无法解析为 NULL
  subject_username TEXT,         -- 便于按人排查；不进入对外契约
  skill_id TEXT,                 -- catalog_view 为 NULL；不做外键
  action TEXT NOT NULL CHECK (action IN ('catalog_view','detail_view','install_command_copy')),
  bucket TEXT CHECK (bucket IN ('all','platform','org','granted') OR bucket IS NULL),
  traffic_source TEXT NOT NULL CHECK (traffic_source IN ('skill_catalog','public_catalog','direct_or_unknown')),
  occurred_at DATETIME NOT NULL
);
CREATE INDEX ... ON catalog_funnel_events (action, traffic_source, occurred_at);
CREATE INDEX ... ON catalog_funnel_events (subject_username, occurred_at);
```

设计点：

- **不要给 `skill_id` 加外键**。技能可能被删除，但事件必须保留；这与 `download_logs` 不对 `skills` 建外键同源。
- `bucket` 只有 `traffic_source = skill_catalog` 时才有值；其他来源为 `NULL`。
- `traffic_source` 缺失或非法一律落 `direct_or_unknown`，不影响任何权限判定。
- 不存搜索关键词、IP、User-Agent、客户端环境；这是 ADR-0077 的核心。
- V1 不设保留期删除；若未来要设，参照 ADR-0067 的「明细过期、聚合保留」另做决定，不要提前写清理任务。

**Repository**：在 `packages/server/src/db/database.ts` 增加 `CatalogFunnelEventRepository`，提供：

- `record(input, at = new Date())`
- `countByAction({ from, to, trafficSource })`（V1 导出够用）
- `queryEvents({ action, trafficSource, from, to, page, pageSize })`（可选，按下载日志的分页形状）

**路由**：新增 `packages/server/src/routes/catalog-events.ts`，在 `app.ts` 注册：

```text
POST /api/catalog/events
body: { skillId?: string, action: 'catalog_view'|'detail_view'|'install_command_copy',
        bucket?: 'all'|'platform'|'org'|'granted',
        trafficSource?: 'skill_catalog'|'public_catalog'|'direct_or_unknown' }
-> 202/204，无响应体
```

校验规则：

- `action` 非法 → 400；`detail_view` / `install_command_copy` 必须带 `skillId`，`catalog_view` 必须不带。
- `bucket` 只在 `trafficSource === 'skill_catalog'` 时接受；其他来源携带则置 `NULL`（或 400，建议宽容置空）。
- 客户端若传 `subject_user_id` / `occurred_at`，一律忽略。
- 未登录可上报（公开目录与直拼流量要入库），`subject_user_id` 为 `NULL`。

**鉴权复用**：把 `authenticateSkillUser` 从 `routes/skills.ts` 抽到共享模块（如 `packages/server/src/services/skill-user-auth.ts`），`skills.ts` 改为 import。T6 不应复制一份 token 解析。

### 2.4 对 T6 的指令

- 事件写入必须「先校验、再落库」，不与权限判定耦合；伪造 `traffic_source` 最多影响报表归属。
- 漏斗口径只在查询层过滤 `traffic_source = 'skill_catalog'`；入库不预过滤，保留公开目录与直拼原始流量。
- `catalog_view` 由页面 `onMounted` / 刷新触发；切桶、翻页、输入关键词不触发。
- `detail_view` 只在详情内容成功渲染（非统一拒绝页）后触发。
- `install_command_copy` 只在 `navigator.clipboard.writeText` 成功 resolve 后触发；当前详情页吞掉复制异常（`packages/web/src/views/public/SkillDetailView.vue:136-142`），T5/T6 需要让组件知道成功/失败。
- 导出不建 UI；由 `CatalogFunnelEventRepository` 提供按动作/来源/时间的计数与明细分页。

### 2.5 已知风险

- 上报端点是公开可调用的，V1 没有防刷；基线期先接受，后续如需要可在网关/路由加限流。**不要用去重掩盖刷量**。
- `subject_user_id` 对 ESL 原生 token 可能为空（`authenticateSkillUser` 只在 Gitea 用户有数值 id 时给出，`skills.ts:1837-1842`），报表按 `subject_username` 兜底。

---

## 3. 共用详情页现状

### 3.1 结论

详情页已经是「公开壳下的独立页面」，登录用户可以直接访问；它**目前没有上下文返回出口、没有归档拦截、且三态响应可区分**。T5 需要改造这一页，而不是新建后台详情页。

### 3.2 证据

- 路由：公开壳 `/skills` 下的 `:scope/:skillName`，`meta.public = true`，不受个人控制台守卫限制：`packages/web/src/router/index.ts:58-73`
- 壳：`PublicLayout` 顶部品牌、语言切换、登录/控制台链接：`packages/web/src/views/public/PublicLayout.vue:1-31`
- 返回出口写死为 `/skills`：`packages/web/src/views/public/SkillDetailView.vue:3`
- 详情请求与错误分支：`SkillDetailView.vue:144-166`
  - 401 → 登录提示
  - 404 → 「未找到该技能」
  - 403 → 服务端可行动文案
- 服务端详情路由：`packages/server/src/routes/skills.ts:1523-1611`
  - 不存在 → 404 `skillNotFound`（1538-1540）
  - 重定向 → 301（1529-1536）
  - 匿名且非 anonymous → 401（1543-1549）
  - 登录但无权 → 403（1546-1548）
  - **未检查 `status === 'archived'`**；只要可读就继续返回内容（1551 起）
  - 匿名可读返回精简 DTO（1568-1595）；登录可读返回完整 DTO（1597-1610）
- 鉴权方式：可选 `Authorization: token ...`，匿名与登录共用同一端点：`skills.ts:1825-1843`、`packages/web/src/api/client.ts:34-48`
- 前端登录态在公开路由上仍会携带 token（`client.ts:41-43`），因此同一详情页可区分「登录后可读 private」与匿名。

### 3.3 对 T5 的指令

1. **返回出口**：根据 `traffic_source` + 登录态计算单一出口
   - `skill_catalog` → 「返回技能目录」，回到 `/admin/me/catalog?bucket=...&q=...`（滚动位置尽力恢复，不承诺精确）
   - `public_catalog` → 现有 `/skills`
   - 无标记直拼：登录 → 技能目录默认全量；匿名 → 公开目录
   - 匿名永不出现「返回技能目录」
2. **三态统一拒绝**：登录主体下，不存在 / 无权 / 已归档统一为同一 HTTP 状态与同一响应体（建议 404 + 通用文案），不返回名称、@scope/name、版本、下载量等任何元数据。维护者查看归档仍走管理向路径。
   - 现有测试 `packages/server/tests/public-visibility.test.ts:139-147` 与 `packages/server/tests/org-skill-authority.test.ts:83-92` 断言详情 403，T5 必须改为「三态响应完全相等」，并同步检查 CLI `info` 的既有 403 指引断言（`packages/cli/tests/info.test.ts:143-165` 是纯 mock，不依赖详情契约，但仍应确认没有端到端断言在等 403）。
3. **归档拦截**：在详情路由读取到 skill 后先判 `status`；`archived` 按不可用处理。当前缺失这一判定（见 3.2）。
4. **复制成功信号**：`copyCommand` 需要返回/抛出可观察结果，供 T6 计数；剪贴板失败不得计数。
5. **匿名行为**：按 spec US14 保持现状（现有非 anonymous 技能返回 401 登录提示）；已归档技能对匿名返回 404（已不可消费，不再给登录提示）。这与「三态对匿名也统一」存在解释冲突，见 §11；T5 在 PM 确认前按此实现，不要顺手改公开目录的其他行为。
6. **CLI 影响**：`esl info` 也走 `GET /api/skills/*`（`packages/cli/src/commands/info.ts:66-78`）。登录用户读取无权 private 技能将从 403 变成与不存在相同的 404，失去 `withAuthGuidanceIfForbidden` 的可行动指引。这是 ADR-0076 的有意代价，T5 不要为 CLI 单独恢复可区分响应。

---

## 4. 公开目录现状与 T3/T4 可直接采用的口径

### 4.1 结论

公开目录是**单次加载、无分页、无显式排序、默认最多 50 条**的列表；卡片已有显示名、Identity、描述、最新稳定版、可见性、下载量。技能目录必须复用同一套查询与字段，不能另写一套。

### 4.2 排序

- `SkillRepository.searchSkills` 的 SQL **没有 `ORDER BY`**：`packages/server/src/db/database.ts:620-656`
- 前端也不排序，按接口返回顺序渲染：`packages/web/src/views/public/CatalogView.vue:26-49`
- 因此当前「默认排序」是 SQLite 的隐式顺序（实际表现为 `skills` 表插入顺序 / rowid 升序，旧→新）。这是未定义行为，不能当成产品契约。

**T3/T4 指令**：抽出唯一共享查询，并补一个**显式、确定**的排序；建议 `ORDER BY created_at ASC, name ASC`（近似今天的插入顺序，同秒用 name 兜底）。两个入口必须用同一条查询，保证顺序一致；V1 不提供排序切换。不要在两个路由各写一个 `ORDER BY`。

### 4.3 分页 / 加载形态

- 服务端：`GET /api/skills/search` 只有 `limit`，没有 `offset` / `page`；默认 50，任意正整数：`packages/server/src/routes/skills.ts:338-361`
- 前端：`onMounted` 一次请求，无分页控件、无「加载更多」：`CatalogView.vue:87-101`
- 超过 50 条会被静默截断（`skills.ts:414`）。

**T3/T4 指令**：形态沿用「单次请求 + 可选 `limit`（默认 50）+ 无 offset」。技能目录 API 的 `limit` 语义与公开目录一致；V1 不做真分页。若未来要分页，作为独立变更，不要只给技能目录加分页而造成两个入口形态漂移。

### 4.4 卡片现有字段

`CatalogView.vue:26-47`：

- 标题：`displayName || name`
- Identity：`name`
- 描述：`description || noDescription`
- 最新稳定版：`latestStableVersion`
- 可见性标签：`visibility`
- 下载量：`downloadCount`

接口条目形状：`CatalogView.vue:60-69`；服务端 enrich：`skills.ts:404-413`。

技能目录卡片在此基础上增加：

- 归属类型 + 主体名（所有桶）
- private 来源行（组织名 / 个人命名空间主体 /「我的技能」）

### 4.5 搜索实现字段

- 数据库预过滤：`name`、`description`、`display_name`、最近未删除 Release 的 `releaseManifest.displayName`：`database.ts:620-633`
- 路由层内存过滤：`name`、`description`、`displayName`、`keywords`：`skills.ts:399-402`
- `keyword` 独立精确过滤：`skills.ts:403`
- 额外过滤参数：`namespace`、`visibility`、`limit`：`skills.ts:342-348`、`381-390`

**T3/T4 可直接采用的搜索字段集（已确认 keywords 存在）**：

| 字段 | 来源 | 备注 |
|---|---|---|
| 技能名称 / `@scope/name` | `skills.name` | 已包含 scope 与短名 |
| 描述 | `skills.description` | 当前源码描述 |
| 显示名 | 最近 Release 快照 `displayName`，缺失回退短名 | ADR-0048 |
| 元数据关键词 | 最近 Release 快照 `keywords` | 见 §6 |

匹配语义：大小写不敏感的子串匹配；`q` 为空即浏览全部；`q` 与 `bucket` 为 AND；只有 `bucket=all` 才跨全集；**先做可读过滤再做关键词匹配**，无权技能不可能被关键词触达。

### 4.6 已知风险

- 默认 50 条截断对「全集」口径是隐性上限。T2/T3 需在实现记录中确认这是沿用公开目录的 V1 形态，不是权限过滤导致的缺失。
- 当前搜索对每个 private 技能调用 `getAccessLevel`，它内部还会为 public 技能查团队以计算 write/manage（`skill-access.ts:39-64`）。技能目录只需要读权限，T2 必须加「public/anonymous 直接可读」短路，否则多组织用户的目录会放大 N+1 调用。

---

## 5. 最新稳定版与下载量的现成查询

### 5.1 结论

两者都有现成、可直接复用的查询；不要新写版本排序或计数逻辑。

### 5.2 最新稳定版（排除 prerelease）

- `highestStableVersion`：`packages/core/src/version/select-version.ts:8-12`（过滤无效 SemVer 与 prerelease，取最高）
- 搜索接口使用：`packages/server/src/routes/skills.ts:410`
- `newestStableRelease`（版本号 → Release 对象）是 `skills.ts` 的私有函数：`skills.ts:1619-1624`
- 详情页使用：`skills.ts:1552`

**指令**：目录 API 直接用 `highestStableVersion(releases.map(r => r.version))`；需要 Release 对象时把 `newestStableRelease` 提升到 `packages/core/src/version/select-version.ts` 或复用现有实现，不要在目录路由复制。前端不要自己用正则判断稳定版（现有详情页 `SkillDetailView.vue:116-119` 的正则只校验 `x.y.z`，会漏掉带 build metadata 的合法稳定版）；以服务端 `latestStableVersion` 为准。

### 5.3 下载量

- 聚合表：`packages/server/src/db/schema.ts:239-252`
- 单技能总量：`packages/server/src/db/database.ts:928-934`
- 版本维度：`database.ts:936-942`
- 批量：`database.ts:945-955`
- 列表富化：`packages/server/src/routes/skills.ts:1879-1890`
- 详情返回总下载量：`skills.ts:1556-1558`、`1580`、`1607`
- 口径：ADR-0067 `docs/adr/0067-download-log-privacy-and-counting.md:8`、`14`；`GLOSSARY.md:556-560`

**指令**：目录列表用 `getSkillDownloadCounts(skillIds)` 批量取，再像 `withDownloadCounts` 一样把内部 `skillId` 从响应中剥掉；不要逐条查。

---

## 6. metadata keywords 是否存在

### 6.1 结论

**存在。** `keywords` 是 Release Manifest 的必填数组字段（可为空数组），搜索与详情已消费；技能目录可以把它纳入搜索字段集，不需要回退。

### 6.2 证据

- Release Manifest schema：`packages/core/src/schema/release-manifest.ts:41-56`（`keywords: z.array(z.string().min(1))` 第 48 行，字段必须存在，语义为空集合允许）
- 发布快照会固化 keywords：`release-manifest.ts` 同文件；`GLOSSARY.md:355-369`
- 关键词解析：`packages/server/src/routes/skills.ts:1754-1766`
- 搜索使用最近 Release 快照关键词：`skills.ts:396-401`
- 详情返回 keywords：`skills.ts:1576`、`1605`
- `skill.json` 也有可选 keywords，但那是安装副本/发布包元数据，不是源码权威源：`packages/core/src/schema/skill-json.ts:17-18`

**指令**：目录搜索使用「最近一次 Skill Release（按发布时间，含 prerelease）」的 keywords，与显示名同源；忽略非字符串、空白与重复项（`releaseKeywords` 已实现）。不要从 `skills` 表加 keywords 列。

---

## 7. Archived 状态在模型中的表达

### 7.1 结论

`archived` 是 `skills.status` 的显式状态；**发现查询排除了它，但消费详情没有排除它**。T2/T3 的目录查询可复用现有过滤；T5 必须补详情拦截。

### 7.2 证据

- `skills.status` 字段：`packages/server/src/db/schema.ts:14`，默认 `published`（历史值）；`database.ts:71` 为旧库补列
- 生命周期状态：
  - `active-unreleased`：`database.ts:214-240`
  - `active-published`：`database.ts:242-250`
  - `archived`：`database.ts:252-254`
  - Restore：`database.ts:256-265`
  - `deleting` / `delete_failed`：`database.ts:303-323`
- 发现查询的已发布过滤：`database.ts:631`（`status IS NULL OR status='published' OR status='active-published'`）
- 管理清单不过滤状态：`database.ts:595-614`；管理 API 返回 `status`：`skills.ts:458`
- 归档动作：`skills.ts:1387-1409`
- 详情路由没有状态判断：`skills.ts:1523-1550`（只判存在、可读、可见性）
- 术语：`GLOSSARY.md:210-216`（Archived Skill）

**指令**：

- T2/T3：目录候选继续使用 `searchSkills` 的已发布过滤；不要自己写 `status !== 'archived'` 的第二套条件。
- T5：详情在读取 skill 后、权限判定前/后统一把 `archived` 当作不可用；归档技能的维护者仍走 `/admin/.../manage` 等管理向路径。
- 不要让归档技能因为 `visibility=anonymous` 在详情页继续可读——这是当前实际行为，必须修。

---

## 8. 各层测试惯例与 `ESL_AUTO_SEED` 接入方式

### 8.1 结论

测试分层清晰：core 纯函数单测、server `buildApp + inject` + fake Gitea、web `@vue/test-utils + mock fetch`、e2e Playwright。`ESL_AUTO_SEED` 只是启动时调用现有 seed 的开关，**现有 seed 远不足以支撑验收**，T7 需要新增可重复的目录 seed。

### 8.2 测试惯例与证据

- 根测试脚本与构建顺序：`package.json:10-23`（`test` 先 build core，再 `vitest run`，再 web；`build` 顺序 core → i18n → server → CLI → web）
- 根 vitest：`vitest.config.ts:4-22`（排除 web/e2e/data，`forks` pool 规避 better-sqlite3 崩溃）
- web 独立 vitest：`packages/web/vitest.config.ts:4-9`（jsdom + setup）
- core 单测：`packages/core/tests/select-version.test.ts:4-26`（纯函数、表驱动）
- server API 测试：`packages/server/tests/search-discovery.test.ts:19-104`（临时 SQLite + `buildApp` + `app.inject` + `createGlobalGitea`）
- fake Gitea 已支持组织隶属与仓库团队：`packages/server/tests/helpers/global-gitea.ts:112-116`（`listUserOrgs`）、`157-163`（`isTeamMember`）、`247-259`（`listRepoTeams`）
- web 组件测试：`packages/web/tests/public-catalog.test.ts:21-68`（`setFetchImpl` 记录请求、挂载真实 router、断言渲染）
- e2e：`playwright.config.ts`、`e2e/`；说明见 `docs/testing/README.md:18`

### 8.3 `ESL_AUTO_SEED` 的实际机制

调用链：

1. 环境变量 `ESL_AUTO_SEED` 为字符串 `'true'` 或 `'1'` 时，`loadServerConfig` 得到 `autoSeed: true`：`packages/server/src/config.ts:47`、`66`
2. `server.ts` 把它传给 `buildApp`：`packages/server/src/server.ts:86-95`（`autoSeed: config.autoSeed` 第 93 行）
3. `buildApp` 在 `autoSeed` 为真时：
   - 同步调用 `seedDevelopmentData(dbPath)`：`packages/server/src/app.ts:127-128`
   - 异步 fire-and-forget 调用 `seedDevelopmentAccounts(giteaService, tenantOrganizationRepository)`：`app.ts:129-137`
4. `seedDevelopmentData` 只插入一个示例技能 `@myorg/my-skill` 与版本 `0.1.0`：`packages/server/src/seed.ts:6-31`
5. `seedDevelopmentAccounts` 创建 `alice`（acme 所有者成员）、`bob`（acme 普通成员）、`acme` 组织及四个常设团队：`seed.ts:44-87`
6. 独立 CLI 入口也可手动 seed：`packages/server/package.json:13`（`npm run seed --workspace @esl/server`），文档见 `docs/guides/local-development.md:185-193`

关键限制：

- `seedDevelopmentData` 使用的是旧 `createSkill`，没有 `skill_releases`，因此该示例技能**不会出现在 `/api/skills/search`**（搜索要求至少一个 Release，`skills.ts:391-393`）。
- 没有多组织成员、无组织新用户、授权 private、未发布、已归档等验收所需形态。
- `seedDevelopmentAccounts` 是异步且不阻塞启动（`app.ts:135-137`），验收走查前需要轮询/等待账号就绪。

### 8.4 对 T7 的指令

- 新增一个**幂等、可重复执行**的目录验收 seed（建议 `packages/server/src/seed-catalog.ts` 或扩展现有 seed 并保持幂等），覆盖：
  - 多组织普通成员账号（至少两个组织，且含一个组织 public、一个组织 private 授权到该成员）
  - 无组织新注册账号
  - 平台 public / anonymous 技能
  - 组织 public、组织 private（全组织档位 / 常设团队 / 自定义团队 / 成员授权各至少一种）
  - 他人个人 private 直授
  - 本人个人 private（来源显示「我的技能」）
  - 未发布技能、已归档技能
- seed 必须通过 `createServerSkill` + `createRelease`（或等价路径）生成真实 `skill_releases`，否则搜索不可见。
- 保留 `ESL_AUTO_SEED` 作为本地演示开关；验收 seed 不要依赖它自动跑，提供显式命令，避免生产误开。
- 测试夹具可复用 server 测试的 fake Gitea；如果 seed 需要 Gitea 团队/协作者，使用 `GiteaService` 的幂等调用（`applyOrgIdentity` 等），不要直接改 Gitea 数据库。

> 实现回修（2026-11-23）：本节的「验收 seed 不要依赖 `ESL_AUTO_SEED` 自动跑，提供显式命令」与 ticket #207 的接入要求冲突。以 ticket 为准：验收 seed 串在账号 seed 之后随 `ESL_AUTO_SEED` 自动执行，生产默认关闭；见走查文档 §3.1。

---

## 9. 两个候选 ADR 的落档决策

### 9.1 三态统一不可区分响应：**落档**

- 文件：`docs/adr/0076-consumer-skill-detail-indistinguishable-rejection.md`
- 理由：这是安全边界与难逆决策。一旦消费详情对不同状态给出不同状态码/响应体，技能存在性就通过 API 泄露；事后收紧会影响所有客户端与测试。必须记录「为什么用 404 而不是 403」「为什么归档不能单独用 410」「维护者走管理向路径」。
- 本 ADR 由 #199 引入；编号按当前 `docs/adr/` 最大编号 0075 之后取 0076。目录中已存在重复编号 0068/0073，本次不复用、不重排历史文件。

### 9.2 漏斗事件最小载荷与来源字段模型：**落档**

- 文件：`docs/adr/0077-skill-catalog-funnel-event-payload.md`
- 理由：字段模型是数据契约，涉及隐私最小化（不存关键词/IP/UA）、匿名主体、来源伪造不影响权限、是否去重、保留期。这些一旦开始采集就无法「未采集」，属于典型难逆决策。
- 本 ADR 由 #199 引入；编号取 0077。

### 9.3 不落档的备选与理由

- 不为「技能目录三桶归类规则」单独立 ADR：它直接由 spec #200 的验收标准与既有 ADR-0032/0037/0038/0064/0065 推导，属于实现口径，不引入新的、难逆的平台决策。归桶规则写在本审计 §1.3 与 T3 测试中即可。
- 不为「目录不做分页」单独立 ADR：它是沿用公开目录现状的 V1 形态，可随产品迭代低成本调整。

---

## 10. 汇总

### 10.1 可直接复用

| 能力 | 位置 |
|---|---|
| 已发布技能检索底座 | `SkillRepository.searchSkills`（`database.ts:620-656`） |
| 版本列表（倒序、排除已删除 Release） | `SkillRepository.getReleases`（`database.ts:794-823`） |
| 最新稳定版 | `highestStableVersion`（`core/src/version/select-version.ts:8-12`） |
| 下载量单条/批量/版本 | `DownloadLogRepository`（`database.ts:928-955`） |
| 下载量列表富化 | `withDownloadCounts`（`skills.ts:1879-1890`；建议提到共享模块） |
| 关键词解析 | `releaseKeywords` / `latestReleaseKeywords`（`skills.ts:1756-1766`） |
| 显示名解析 | `resolveSkillDisplayName`（`skills.ts:1748-1752`） |
| 请求时刻读权限 | `getAccessLevel` / `hasReadAccess`（`skill-access.ts:25-82`） |
| 用户组织集合 | `GiteaService.listUserOrgs`（`gitea.ts:612-634`） |
| 命名空间类型 | `tenantOrganizationRepository.get(scope)?.status === 'active'`（同 `skills.ts:182-183` 口径） |
| 可选登录鉴权 | `authenticateSkillUser`（`skills.ts:1825-1843`；T6 前抽共享） |

### 10.2 必须新增的模块边界

1. **core 领域层（唯一口径源）**：新增 `packages/core/src/discovery/`（或 `skill-catalog/`），提供：
   - `CatalogBucket`、`CatalogPrincipal`、`CatalogCandidate` 类型
   - `classifyCatalogBucket(candidate, principal)`
   - `filterCatalogCandidates(candidates, { bucket, query, fields })`
   - `resolveCatalogSource(candidate, principal)` → `{ kind: 'organization'|'person'|'self', name }`
   - 搜索匹配（名称/描述/显示名/keywords）与桶 AND 语义
   - 排序契约（或由服务端查询统一排序，core 不排序）
2. **server 发现服务**：新增 `packages/server/src/services/skill-catalog.ts`，负责：
   - 取候选（已发布 + 已归档排除）
   - 登录主体一次性取组织集合
   - 逐条可读判定（public/anonymous 短路，private 查 `getAccessLevel`）
   - 富化显示名、最新稳定版、keywords、下载量
   - 调用 core 归桶/过滤/来源
   - **公开 `/api/skills/search` 与新 `/api/catalog/skills` 都调用它**；匿名是 `principal.username = null` 的特例
3. **server 路由**：
   - `GET /api/catalog/skills`（T2：鉴权必需、全集；T3：`bucket`/`q`/`limit`）
   - `POST /api/catalog/events`（T6）
4. **web**：
   - 个人控制台菜单第六项与路由（T4）
   - 目录页（T4）
   - 详情页上下文返回与统一拒绝（T5）
5. **数据库**：
   - `catalog_funnel_events` 表（T6）
   - 不新增 `skills` 字段；不加 keywords 列

### 10.3 已知风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 授权执行人不落库 | 个人 private 来源只能显示命名空间主体 | §1.5 口径 + PM 确认；不新增 V1 schema |
| 离组后 owner/maintainers 残留 | 可能出现「可读但不在我的组织集合」的组织技能 | §1.3 fail closed；根因另开票清理 |
| 每技能 N+1 Gitea 调用 | 多组织、多 private 技能时目录变慢 | public/anonymous 短路；组织集合一次取；必要时按请求内缓存/批量 |
| `getAccessLevel` 对 public 也查团队 | 目录读路径放大调用 | T2 只对 private 调用 |
| 搜索无显式排序 | 两个入口顺序可能漂移 | 抽共享查询并显式 `ORDER BY` |
| 默认 50 条截断 | 全集被静默截断 | 沿用公开目录形态并在实现记录中注明；后续单独做分页 |
| 详情未拦 archived | 归档技能仍可被消费 | T5 补状态拦截 |
| 三态统一与匿名现状冲突 | 匿名存在性仍可区分 | 见 §11，PM 确认后再定实现 |
| 新目录端点绕过组织门禁 | 冻结/删除中组织的技能可能出现在目录 | 扩展 `app.ts:257-289` 的 `/api/skills` 前缀门禁或复用该前缀 |
| 事件端点可被刷 | 基线数字虚高 | V1 接受；后续网关限流，不做去重掩盖 |
| 目录/公开两套过滤漂移 | 信任损伤 | core + server service 单一实现；测试断言两个入口同源 |

---

## 11. 需要 PM 决策的事项

1. **「授权方显示名」的口径**（§1.5）：V1 采用「个人技能所属命名空间主体」是否可接受？若必须精确到授权执行人，需要新增授权审计字段，属于 schema 变更，建议另开票。
2. **三态统一是否覆盖匿名**（§3.3 / §9.1）：spec US14 要求匿名详情行为完全不变（现有 public 技能返回 401 登录提示），而 US16 要求不可区分。建议：登录主体统一 404；匿名保持现状。若 PM 要求匿名也统一，则公开目录的「登录后查看」提示与现有测试需要同步改口径。
3. **目录是否接受 50 条上限**（§4.3）：V1 沿用公开目录单次 `limit=50`、无分页。若 PM 认为「全集」必须完整，需要把分页提前到 V1（会增加 T2/T3/T4 工作量）。

---

## 12. 后续票交接清单

- **T2（#202）**
  - 先抽 `authenticateSkillUser` 到共享模块；新增 `/api/catalog/skills`（鉴权必需）
  - 新增 server `skill-catalog` 服务与 core `discovery` 纯函数；`/api/skills/search` 改为复用同一服务，匿名行为与响应字段保持不变
  - 只对 private 调 `getAccessLevel`；组织集合用 `listUserOrgs`；异常 fail closed
  - 新端点必须覆盖组织激活门禁（`app.ts:257-289`）；不要让它绕过冻结/删除中的组织拦截
  - 条目含 identity、显示名、描述、最新稳定版、可见性、下载量、归属类型
- **T3（#203）**
  - 在 T2 服务上接 `bucket` / `q` / `limit`；归桶规则按 §1.3；来源按 §1.4/§1.5
  - 搜索字段集按 §4.5；先可读过滤再关键词；桶与关键词 AND
  - 排序与分页按 §4.2/§4.3，与公开目录共用同一条查询
- **T4（#204）**
  - 个人控制台菜单第六项（概览 / 个人信息 / 我的组织 / 技能 / 技能目录 / 邀请），路由建议 `/admin/me/catalog`
  - 卡片字段按 §4.4；i18n 同时补 zh/en（`packages/i18n/src/resources.ts:532-560`、`1168-1196`）
- **T5（#205）**
  - 详情页返回出口按 `traffic_source` + 登录态；`SkillDetailView.vue:3` 改为动态出口
  - 服务端三态统一并补 archived 拦截；维护者管理向路径不变
  - `copyCommand` 暴露成功/失败结果
- **T6（#206）**
  - 新表 `catalog_funnel_events` + Repository + `POST /api/catalog/events`，按 §2.3
  - 三层事件触发点按 §2.4；只统计 `skill_catalog`；无 UI
- **T7（#207）**
  - 按 §8.4 新增幂等验收 seed；两个账号 + 各可见性/授权/未发布/已归档
  - 走查前等待异步账号 seed 完成；测试复用 fake Gitea 与 `buildApp`
