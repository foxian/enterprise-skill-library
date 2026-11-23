# #199 技能目录：验收 seed 与 AC1–AC12 走查记录

- 关联：Spec #200、本票 #207、父需求 #199
- 分支：`feat/199-skill-catalog`
- 范围：只交付可重复执行的验收 seed、自动化走查测试与本记录；不新增产品功能、不改 API 契约
- 验收账号密码：`esl-dev-password`（仓库既有开发账号常量 `DEV_ACCOUNT_PASSWORD`）

## 1. 如何得到验收环境

验收 seed 复用既有 `ESL_AUTO_SEED` 机制，只在开发/演示环境开启：

```powershell
# .env
ESL_AUTO_SEED=true

docker compose up -d api server
```

启动时依次执行两个独立后台任务：

1. `seed-development-accounts`：账号、组织、常设团队、组织身份（`packages/server/src/seed.ts`）。
2. `seed-catalog-acceptance`：技能、Release、Gitea 仓库与授权（`packages/server/src/seed-catalog.ts`）。

第二个任务串在第一个之后，因为技能授权依赖账号、组织与团队已经存在。两者都只记录
`task.started / task.succeeded / task.failed`，失败不阻塞服务启动。查看日志确认：

```text
task.succeeded  seed-development-accounts
task.succeeded  seed-catalog-acceptance
```

seed 是幂等的：重复启动不会重复插入技能/Release，Gitea 仓库先 `getRepo`，
团队按名称判存在，协作者与团队挂载使用既有幂等接口。需要彻底干净的数据时再执行
`npm run reset:dev`（会删除开发数据卷，属于破坏性操作）。

`ESL_AUTO_SEED` 未开启时不会写入任何验收数据；生产环境保持默认 `false`。

## 2. 账号矩阵

| 用户名 | 密码 | 组织与身份 | 用途 |
|---|---|---|---|
| `alice` | `esl-dev-password` | `acme` 所有者成员、`beta` 所有者成员 | 技能发布者、组织管理者（对照主体） |
| `bob` | `esl-dev-password` | `acme`、`beta` 普通成员（三个技能授权团队，不进 `org-managers`） | 多组织普通成员，AC2/AC4/AC6/AC8/AC9 主走查账号 |
| `carol` | `esl-dev-password` | 无组织 | 无组织新注册用户，AC3/AC5/AC11 主走查账号 |
| `dave` | `esl-dev-password` | 无组织 | 「他人个人 private 技能」的发布者 |

两个验收组织都预置 `all-readers`、`all-writers`、`all-managers`、`org-managers`
四个常设团队。`acme` 额外有自定义团队 `reviewers`（`reviewers-read/-write/-manage`
三个后端投影）。

## 3. 技能与授权矩阵

| 技能 | 可见性 | 状态 | 到达 bob 的方式 | bob 桶 | carol 桶 |
|---|---|---|---|---|---|
| `@alice/anon-tool` | anonymous | 已发布 | 平台匿名档 | platform | platform（匿名目录也可见） |
| `@alice/community-tool` | public | 已发布 | 平台公开档 | platform | platform |
| `@bob/own-public` | public | 已发布 | 本人发布 | platform | platform |
| `@acme/public-tool` | public | 已发布 | 组织公开 | org | platform |
| `@beta/open-tool` | public | 已发布 | 组织公开（第二个组织） | org | platform |
| `@acme/all-readers-tool` | private | 已发布 | 全组织档位 / 常设团队 `all-readers`（read） | org | 不可见 |
| `@acme/all-writers-tool` | private | 已发布 | 全组织档位 / 常设团队 `all-writers`（write） | org | 不可见 |
| `@acme/all-managers-tool` | private | 已发布 | 全组织档位 / 常设团队 `all-managers`（manage） | org | 不可见 |
| `@acme/custom-team-tool` | private | 已发布 | 自定义团队 `reviewers`（read） | org | 不可见 |
| `@acme/member-grant-tool` | private | 已发布 | 成员授权（Git 协作者） | org | 不可见 |
| `@acme/owner-only-tool` | private | 已发布 | 无显式授权；所有者/管理成员角色 | 不可见（由 `alice` 走查） | 不可见 |
| `@acme/secret-tool` | private | 已发布 | 未授权 | 不可见 | 不可见 |
| `@dave/private-note` | private | 已发布 | 他人个人 private 直授 | granted | 不可见 |
| `@dave/unshared-note` | private | 已发布 | 未授权 | 不可见 | 不可见 |
| `@bob/own-private` | private | 已发布 | 本人发布 | granted（来源「我的技能」） | 不可见 |
| `@acme/draft-tool` | public | 未发布（无 Release） | — | 不可见 | 不可见 |
| `@acme/retired-tool` | public | 已归档（有 Release） | — | 不可见 | 不可见 |

口径说明：

- 「全组织档位」与「常设团队」在当前授权模型中是同一个机制：把 `all-readers` /
  `all-writers` / `all-managers` 挂到技能仓库上。矩阵用 read/write/manage 三档各一个
  技能覆盖，不再虚构第二条常设团队路径。
- 「成员角色」不是逐技能授权来源：普通成员身份本身不会放开组织 private。组织
  所有者/管理成员（`alice`）走成员角色获得管理权；`@acme/owner-only-tool` 没有任何
  显式团队/成员授权、owner 也不指向 `alice`，专门用于证明「所有者成员经角色可读、
  普通成员不可见」。`bob` 按 spec 角色固定为普通成员，其可达形态由三档常设团队、
  自定义团队与成员授权覆盖。
- 本人 private 由服务端给出 `source.kind = 'self'`，Web 渲染「我的技能」；他人个人
  private 显示技能所属个人命名空间（`@dave`），与 ADR/技术核查 §1.5 的口径一致。
- 卡片不显示团队名与授权档位；组织技能来源显示组织名。
- 已知上限：目录沿用公开目录 V1 形态，单次 `limit=50`、无 offset；验收数据集只有
  十余条不受影响，但 AC2 在真实环境超过 50 条时会被静默截断（不是权限过滤导致）。

数量核对：`bob` 的「全部」为 12 条（平台 3 + 我的组织 7 + 授权给我 2）；
`carol` 的「全部」为 5 条，`org` 与 `granted` 为空；匿名公开目录只有
`@alice/anon-tool` 1 条。`alice` 作为两个组织的所有者成员额外可见
`@acme/secret-tool`、`@acme/owner-only-tool` 等组织 private 技能（用于成员角色对照）。

### 3.1 口径补充

- **V1 单次加载上限**：目录与公开目录同形，单次 `limit`（默认 50）、无 offset；
  超过 50 条会被静默截断。AC2 的「全集」只在该上限内成立，真实环境技能更多时需
  按分页另行变更，不能把截断误读成权限缺失。
- **事件端点鉴权**：`POST /api/catalog/events` 按 ADR-0077 允许匿名调用（公开目录与
  直拼流量也要入库）。无 `Authorization` 直接 202；只有携带**无效 token** 才 401。
  ticket #206 原文的「需鉴权」以 ADR-0077 为准。
- **平台管理员出口**：管理员直拼 `/skills/<scope>/<name>` 时的单一返回出口是公开
  目录（ADR-0033：超管不进个人控制台），页面不会出现「返回技能目录」；即使 URL 带
  `traffic_source=skill_catalog` 也一样。
- **成员角色授权形态**：`@acme/owner-only-tool` 无显式团队/成员授权，owner 也不指向
  `alice`，用于验证所有者/管理成员凭角色可读、普通成员不可见。
- **`ESL_AUTO_SEED` 取舍**：技术核查 §8.4 曾建议「验收 seed 不自动跑，提供显式命令」，
  但 ticket #207 要求接入 `ESL_AUTO_SEED`。本实现以 ticket 为准：验收数据串在账号
  seed 之后，随 `ESL_AUTO_SEED` 自动执行；生产默认 `false`。

## 4. AC1–AC12 结论

| AC | 结论 | 证据 |
|---|---|---|
| AC1 侧边栏第六项与既有页面不变 | 通过 | Web：`packages/web/tests/skill-catalog.test.ts`「侧边栏第六项为技能目录，进入后默认加载全部桶」「既有管理向「技能」页仍可进入且页面不变」。Server：目录端点未登录返回 401（`packages/server/tests/skill-catalog.test.ts`）。 |
| AC2 多组织成员默认「全部」恰为可安装全集 | 通过 | `seed-acceptance.test.ts`「AC2/AC4…」断言 12 条全集，未发布/归档/无权不出现。 |
| AC3 直拼 private/归档详情与不存在不可区分 | 通过 | `seed-acceptance.test.ts`「AC3…」：越权 private、他人个人 private、已归档、不存在四者均为 404 且响应体逐字节一致。 |
| AC4 三桶互斥、就近、多组织扁平、来源正确 | 通过 | `seed-acceptance.test.ts`「AC2/AC4…」：三桶并集等于全集且无重复；组织 public 在 org、本人 public 在 platform、本人 private 来源 `self`。Web：`skill-catalog.test.ts` 桶切换与来源文案测试。 |
| AC5 无组织用户 org 空、platform 有内容 | 通过 | `seed-acceptance.test.ts`「AC5…」：carol 全集 5 条、org/granted 为空、匿名公开搜索只有 anonymous 技能。Web：`skill-catalog.test.ts`「无组织用户的「我的组织」桶给出专门空态」。 |
| AC6 关键词与桶 AND，无权不泄露 | 通过 | `seed-acceptance.test.ts`「AC6…」：桶内命中、跨桶为空、keywords/显示名大小写不敏感、secret/draft 关键词不泄露。Web：`skill-catalog.test.ts`「关键词与当前桶 AND 叠加…」。 |
| AC7 卡片字段与来源行 | 通过 | Server 契约字段在 `seed-acceptance.test.ts`「AC2/AC4…」中断言；渲染与「我的技能」文案由 `skill-catalog.test.ts`「卡片展示识别字段与来源…」覆盖。 |
| AC8 卡片 → 详情 → 复制 → 返回恢复 | 通过 | Server：`seed-acceptance.test.ts`「AC8/AC11…」授权 private 详情 200。Web：`skill-detail.test.ts`「从技能目录进入时只有一个「返回技能目录」出口…」「授权 private 正常打开并展示安装命令」「点击返回出口回到技能目录并重新请求列表」。 |
| AC9 权限收紧/归档后列表消失、详情统一拒绝 | 通过 | `seed-acceptance.test.ts`「AC9…」：撤销协作者与归档后列表移除且详情与不存在同形。Web：`skill-detail.test.ts` 统一拒绝与返回后重新加载测试。 |
| AC10 三层事件计数可取、只计 skill_catalog | 通过 | `seed-acceptance.test.ts`「AC10…」用 `CatalogFunnelEventRepository.countByAction` 断言三层各 1，公开目录来源单独计数且不进漏斗。Web：`packages/web/tests/catalog-funnel-events.test.ts`。 |
| AC11 匿名只见 anonymous，登录见全集，详情同源 | 通过 | `seed-acceptance.test.ts`「AC5…」匿名公开搜索、`「AC8/AC11…」`匿名/登录详情行为；Web：`skill-detail.test.ts`「匿名直拼回公开目录，且任何匿名场景都不出现「返回技能目录」」。 |
| AC12 seed 覆盖齐全且可重复 | 通过 | `seed-acceptance.test.ts`「is idempotent…」「AC12…」「an organization private skill without explicit grants…」以及 `packages/server/tests/seed.test.ts` 新增账号/组织幂等断言。 |

未由自动化覆盖、留给 PM 手工确认的部分：视觉排版、滚动位置的实际观感，以及
真实浏览器中的剪贴板授权弹窗（Web 测试用 mock 断言成功/失败分支）。

## 5. PM 在演示环境复走步骤

1. 按第 1 节开启 `ESL_AUTO_SEED` 并等待两个 seed 任务成功。
2. 用 `bob` / `esl-dev-password` 登录，进入个人控制台，确认侧边栏第 6 项为
   「技能目录」（位于「技能」与「邀请」之间），点击进入 `/admin/me/catalog`。
3. 「全部」应有 12 条。依次切「平台公开」（3 条）、「我的组织」（7 条，含 `acme`
   与 `beta` 两个组织名）、「授权给我」（2 条）。确认同一技能不在两个桶重复；
   `@bob/own-private` 的来源行显示「我的技能」；`@dave/private-note` 显示 `dave`。
   用 `alice` 复核成员角色：`@acme/owner-only-tool` 只在 `alice` 的「我的组织」出现，
   `bob` 看不到它。
4. 在「我的组织」输入 `code-review`，只剩 `@acme/custom-team-tool`；切到「平台公开」
   同一关键词为空。输入 `secret` 在任何桶都应为空（越权不因关键词泄露）。
5. 点击 `@acme/member-grant-tool` 或 `@dave/private-note` 进入详情，确认可查看介绍并
   复制安装命令；点击「返回技能目录」，确认回到原桶且关键词仍在。
6. 越权红线：登录 `bob` 后直拼 `/skills/acme/secret-tool`、`/skills/acme/retired-tool`
   与不存在的 `/skills/acme/not-exist`，三者都应是同一个「无权访问或已下架」/未找到
   形态，页面不出现技能名、版本、下载量。再用 `carol` 重复一次。
7. 用 `carol` / `esl-dev-password` 登录：目录「全部」5 条，「我的组织」空态、
   「授权给我」空态，「平台公开」仍可浏览。
8. 退出登录，打开免登录公开目录 `/skills`：只有 `@alice/anon-tool`；打开其详情，
   返回出口必须是公开目录，且不出现「返回技能目录」。登录 `bob` 后打开同一详情，
   仍按公开目录来向返回（来源标记为 public_catalog）。

## 6. 验证命令

```powershell
npx vitest run packages/server/tests/seed.test.ts packages/server/tests/seed-acceptance.test.ts
npm test
npm run build
npm test --workspace @esl/web
```

本记录只把 server 侧的固定数据走查做成自动化；e2e（`npm run test:e2e`）依赖本机
docker 集成栈，是否执行以交付记录为准，未执行时不以其他测试冒充结果。

## 7. 本次交付验证结果（2026-11-23）

| 命令 | 结果 |
|---|---|
| `npx vitest run packages/server/tests/seed.test.ts packages/server/tests/seed-acceptance.test.ts` | 14 passed |
| `npm run build` | 通过（core / i18n / server / CLI / web） |
| `npm test` | 1602 passed、2 skipped、2 failed；两个失败都与本票改动无关：`packages/core/tests/external-materialize-guard.test.ts` 创建符号链接的 Windows `EPERM`，以及 `packages/cli/tests/version-command.test.ts` 在全量并发下超时（单文件运行 14 passed） |
| `npm test --workspace @esl/web` | 225 passed |
| `npm run test:e2e` | 未执行：本机没有运行中的 docker 集成栈（`docker compose ps` 为空） |

`npm test` 的两个失败都需要环境条件：符号链接用例需要宿主机允许创建符号链接（Windows
开发者模式或管理员权限）；CLI 用例是全量并发下的超时，单文件运行时通过。两者都不是
断言失败，未修改或跳过测试来掩盖环境问题。

