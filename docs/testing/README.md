# 测试文档

## 现行口径：自动化测试本身就是口径

本目录不维护手工用例清单——用例写在测试文件里，跑得过就是通过。找覆盖请直接读源码：

| 层级 | 位置 | 跑法 |
|------|------|------|
| core / server / cli 单元与集成 | `packages/{core,server,cli}/tests/**` | `npm test` |
| web 组件与路由守卫 | `packages/web/tests/**` | `npm test` |
| 浏览器 E2E（真实 Docker 栈） | `e2e/tests/*.spec.ts` | `npm run test:e2e` |

E2E 目前两条，一条对应一个不可回退的承诺：

- `e2e/tests/golden-path.spec.ts` —— API 金路径：注册 → 建组织 → 拉人 → `@组织` 发布 → 安装
- `e2e/tests/console-routing.spec.ts` —— 角色落点与路由守卫（超管 / 个人控制台不互越界）

跑 E2E 前需重建 api 镜像；本地 `.env` 需 `ESL_AUTO_SEED=true` 才有开发账号。环境细节见
[../guides/local-development.md](../guides/local-development.md)。

测试策略、分层比例与风险矩阵见 [../qa-strategy.md](../qa-strategy.md)。⚠️ 该文档
§1 目标与 §3「纯单元层与 E2E 缺失」一节写于 ADR-0025 时代，其中的用例数基线
（server 321 / cli 221 / web 81）与"3 条关键旅程"已被 ADR-0032 的改组取代，尚未
回填——引用前请以本页表格与 `e2e/tests/` 为准。

## archive/：历史执行记录

`archive/` 下是按特性一次性产出的手工 E2E 用例与执行报告。它们记录的是**当时**的事实，
不随代码更新。多数写成于 ADR-0032 之前，其中的角色、路由、账号形态与流程（三角色视角、
`<org>_admin` 账号、一次性密码、Operation/Provisioning 状态机、部署模式）**已废除**——
照它们验收会得到错误结论，每份顶部都有对应横幅。

| 文档 | 主题 | 被谁取代 |
|------|------|---------|
| `archive/web-console-e2e-test-cases.md` | 三角色控制台手工用例（AUTH / SUPER / ORG / MEMBER） | ADR-0032 / 0033 / 0035 |
| `archive/web-console-workflow-test-cases.md` | 组织生命周期与 Operation 工作流用例（Issue #15–#22） | 同上 |
| `archive/web-console-workflow-test-report.md` | 上述用例 2026-09-03 的执行结果 | — |
| `archive/deployment-mode-e2e-test-cases.md` | 部署模式与默认组织用例（ADR-0022） | ADR-0032（正文明确取代 ADR-0022） |
| `archive/deployment-mode-e2e-test-report.md` | 上述用例 2026-09-06/07 的执行结果 | — |

保留而非删除，与 `docs/adr/` 保留被取代 ADR 的做法一致：决策与那一次执行的结论都是历史，
不该因为后来的模型变更而消失。
