# ESL QA 策略

## 1. Scope & Objectives

**In scope:** ESL 全部四个包（core / server / cli / web）的功能正确性、权限与多租户隔离、发布链不可变语义、跨系统（Gitea）一致性；测试类型为功能/API/组件级 + 少量关键路径 E2E。

**Out of scope:** 性能压测（当前无容量压力）、视觉回归、无障碍专项（Web 后台内部工具，Element Plus 自带基础语义）、AI/LLM 特性（本产品消费技能而非生成内容）。

**Objectives（截至 2026-Q4）:**
1. 权限判定（canManageSkill / getAccessLevel）与 inventory 隔离逻辑达到**分支全覆盖**——这是 CRITICAL 风险区（见 §4）。
2. 建立可重复的合入门禁：`npm test` 三套全绿是合入前置（当前已是事实，落成文档 + 可选 CI）。
3. 引入最小浏览器 E2E：覆盖 3 条关键旅程（超管技能总览、成员双 Tab、组织管理员代管权限），目标套件 <5min。
4. 所有跨系统变更（Operation）的幂等/重试路径有测试锚定，防止孤儿资源回归。

## 2. Test Levels & Types

| 层级 | 验证内容 | Owner | 框架 | 目标规模 | 频率 |
|------|---------|-------|------|---------|------|
| 纯单元 | core 领域函数（账号解析、Manifest 校验、权限推导） | Dev | Vitest | 当前缺失，补齐 | 每次提交 |
| API/集成 | server 路由 + Operation + SQLite + Gitea mock | Dev | Vitest + `app.inject()` | 主层（当前 321） | 每次提交 |
| 命令级 | cli 命令解析/网络/错误路径 | Dev | Vitest | 当前 221 | 每次提交 |
| 组件 | web 视图/权限面板/路由守卫 | Dev | Vitest + @vue/test-utils | 当前 81 | 每次提交 |
| E2E | 关键旅程（§1-3） | Dev | Playwright（新增） | 3 条旅程 ≤10 用例 | 合入/夜跑 |

## 3. Test Pyramid Analysis

**当前形态：菱形（integration-heavy）。** server 321 个 API 集成测试、cli 221、web 81 组件，**纯单元层缺失、浏览器 E2E 缺失**。集成层承担了本应在单元层覆盖的边界逻辑（如 `getAccessLevel` 的三档推导可抽纯函数单测）。

**目标形态（6 个月后）：** 单元约 45%（补 core 纯函数 + server 内可抽的判定纯函数）、API/集成约 45%（保持）、组件约 8%、E2E 约 2%。比例不追求教科书 70:20:10——本产品无页面 UI 之外的大面积展示层，集成测试是正确的主层。

**行动：** ① 权限判定抽纯函数（`getAccessLevel` 依赖注入 skill 快照 + Gitea 查询接口），便于单元测试；② E2E 仅覆盖跨进程关键旅程，不复制集成测试已覆盖的逻辑。

## 4. Risk Assessment Matrix

| 领域 | 影响 | 可能性 | 得分 | 测试对策 |
|------|------|--------|------|---------|
| 权限判定与三档授权 | 5 | 3 | 15 CRIT | 纯函数单测 + API 集成 + 每提交 |
| 多租户隔离（scope 过滤） | 5 | 3 | 15 CRIT | inventory/搜索跨组织负用例 |
| Operation 幂等与 Gitea 一致性 | 4 | 3 | 12 HIGH | 幂等键/重试/补偿测试锚定 |
| 发布链不可变 | 4 | 2 | 8 MED | checksum/Tag/依赖锁测试 |
| 超管治理边界（冻结组织放行） | 3 | 2 | 6 MED | 门禁正/负用例 |
| Web 权限 UI 可及性 | 2 | 4 | 8 MED | 组件测试覆盖 403 降级 |
| 技能消费（install/adapt） | 3 | 2 | 6 MED | 现有 cli 测试保持 |

## 5. Environment Strategy

| 环境 | 用途 | 测试类型 | 数据 | 触发 |
|------|------|---------|------|------|
| 本地 dev（docker compose） | 开发反馈 | 手动 + API | `ESL_AUTO_SEED` 示例数据 | 手动 |
| 本地测试（Vitest） | 自动化验证 | 单元/集成/组件/命令 | 每测试临时 SQLite + Gitea mock | 每次提交 |
| E2E（可选，docker 全栈） | 关键旅程 | Playwright | 隔离账号 | 合入/夜跑 |

无 staging/prod 环境（自托管产品由客户部署）；策略不针对多环境，重点在本地可复现。

## 6. Tool Selection Rationale

| 标准（权重） | Vitest（现状） | Playwright（新增 E2E） |
|------|------|------|
| 契合技术栈（25%） | 5 | 4（Vue SPA + Node server） |
| 熟悉度（20%） | 5 | 3（需新学，但脚本式 E2E 已有文档） |
| 社区/文档（15%） | 5 | 5 |
| CI 集成（15%） | 5 | 5 |
| 维护成本（10%） | 5 | 3（浏览器依赖、选择器漂移） |
| 执行速度（10%） | 5 | 2 |
| 许可成本（5%） | 5 | 5 |
| **加权** | **5.0** | **3.8** |

**结论：** 保持 Vitest 为主力（三套已成熟、无 CI 约束下执行快）；Playwright 仅在需要全栈浏览器验证时引入，规模受控（§2 目标 ≤10 用例）。当前不引入契约测试、视觉、压测工具——solo 团队 ROI 不足。

## 7. CI Scaling Levers

当前无 CI。**先建立再谈缩放**：本地门禁（`npm test`）+ 可选 GitHub Actions 按包分片（server / cli / web 三 job 并行）。若引入 CI，衡量 `CI-minutes-per-PR`；E2E 与单元分 job，避免长尾拖慢反馈。分片策略：按包而非按用例——包边界即依赖边界，改动只触发受影响包（借助 workspace 依赖图）。

## 8. Entry/Exit Criteria

- **API/集成（主层）** — Entry：路由/服务可编译、Gitea mock 齐备、临时 SQLite 建好。Exit：目标断言全绿、无跳过、权限/隔离负用例齐备。
- **组件** — Entry：`useApiMock` 覆盖视图调用的端点。Exit：关键视图（成员双 Tab、超管总览、权限面板三档）有断言、403 降级被验证。
- **E2E** — Entry：docker 全栈可启动、隔离测试账号就绪。Exit：3 条旅程全绿、无硬编码等待。
- **Release/合入** — Entry：`npm test`（三套）全绿 + 变更对应测试已随行。Exit：E2E（若引入）全绿、无 CRITICAL/HIGH 缺陷、回滚路径清晰（`reset:dev`）。

## 9. Quality Gates & Definition of Done

- **PR/合入门禁（当前生效，落成文档）**：`npm test` 全绿；权限/隔离相关改动必须带正反用例；ADP（ADR）决策不改不回退测试。
- **覆盖门禁**：CRITICAL 区（§4 前两行）相关函数改动，行覆盖不得下降；以本次 ADR-0025 测试（321→329）为基线。
- **Nightly**：可选；引入 E2E 后跑关键旅程。
- 门禁在 CI 落地前以文档 + 开发者自律执行——诚实标注：**当前无 CI 强制**，这是首要补齐项。

## 10. Metrics & KPIs

| 指标 | 定义 | 目标 | 节奏 |
|------|------|------|------|
| 用例数 | 三套合计 | server ≥321（基线，只增不降） | 每次合入 |
| 套件时长 | 本地三套 | server<10s / cli<5s / web<60s | 每两周 |
| CRITICAL 区覆盖 | 权限/隔离相关分支 | 100%（新逻辑） | 每次合入 |
| Flake 率 | 连续 3 次跑稳定 | 0（本地确定性环境） | 每月 |
| E2E 套件时长 | 引入后 | <5min | 每月 |
| 缺陷逃逸 | 测试外发现的功能缺陷 | 每功能 ≤1 | 每版本 |

## 11. Timeline & Milestones

- **Phase 1（W1-2）**：本策略落档；ADR-0025 权限/隔离覆盖补全（见 `docs/qa-test-plan.md` 第一迭代）。
- **Phase 2（W3-6）**：权限判定抽纯函数 + 单元层起步；评估 CI（GitHub Actions 三 job）。
- **Phase 3（W7-12）**：若引入 E2E，Playwright 覆盖 3 条关键旅程；CI 门禁落地（`npm test` 强制）。
- **Ongoing**：每季度回顾策略；每次 ADR 决策对照 §4 风险矩阵更新测试对策。

## 12. Executive Summary

ESL 是一个权限敏感、强多租户隔离的自托管平台，质量主线 = **权限正确性 + 隔离性 + 跨系统一致性**。当前已有扎实的 API 集成层（321 用例），但纯单元层与 E2E 缺失、无 CI 门禁。策略：以 CRITICAL 风险区为重心巩固集成层，补齐单元层与最小 E2E，并在合入前建立可重复的门禁。solo 团队执行，一切工具选择以 ROI 为先，不追逐全量自动化。

## 13. Revision History

| 日期 | 版本 | 变更 | Owner |
|------|------|------|-------|
| 2026-09-08 | 1.0 | 初版：基于 ADR-0025 实现后的测试基线（server 321 / cli 221 / web 81） | cnfox |
