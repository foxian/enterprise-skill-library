# Sprint 测试计划：ADR-0025 管理权三档与角色化技能可见性

## Scope

| 范围项 | 说明 | 状态 |
|--------|------|------|
| 权限三档模型（read/write/manage） | 个人/团队均可授权；manage 映射 Gitea admin | 已实现 |
| 管理权语义（publish/rename/archive/notes/配置守门统一） | 原 maintainers-only 路由放宽到 manage 判定 | 已实现 |
| 超管跨组织可见性与冻结组织放行 | hasReadAccess/canManageSkill/门禁 | 已实现 |
| `/api/skills/inventory` 角色化清单（含未发布） | 成员/组织管理员/超管三视角 | 已实现 |
| 团队 manage 档 + 词汇归一化（manage↔admin） | org-console 创建/返回 | 已实现 |
| CLI `share --manage` | 命令解析 | 已实现 |
| Web：成员双 Tab、超管总览、面板三档、团队三档 | 视图/组件 | 已实现 |

**变更外（不测）**：非本 ADR 的工作区改动（upload git 身份兜底）。

## 需求→测试覆盖矩阵

| 需求 | 场景 | 优先级 | 测试位置（已存在） | 状态 |
|------|------|--------|---------------------|------|
| REQ-2 manage→admin 映射 | add_member manage → addCollaborator('admin') | P0 | rbac-permissions「grants manage permission…reports it as manage」 | ✅ |
| REQ-3 管理权协作者 | 配权限 + publish | P0 | rbac-permissions「manage-level collaborator configure and publish」 | ✅ |
| REQ-3 管理权团队 | 团队 admin 级代管 | P0 | rbac-permissions「manage-level team member」 | ✅ |
| REQ-4 write 不可 publish | write 协作者被拒 | P0 | rbac-permissions「still rejects publishing…write-level」 | ✅ |
| REQ-6 成员 inventory | managed/shared 含未发布 | P0 | rbac-permissions「member inventory split」 | ✅ |
| REQ-6 组织管理员 inventory | 本组织全部、managed | P0 | rbac-permissions「full organization inventory」 | ✅ |
| REQ-5 超管 inventory | 跨组织含未发布 | P0 | rbac-permissions「cross-organization inventory」 | ✅ |
| REQ-5 冻结组织放行 | 平台管理员巡检 | P0 | app.test「lets the platform administrator inspect…non-active tenant」 | ✅ |
| REQ-10 矩阵归一化 | member 档显示 manage | P0 | rbac-permissions「reports it as manage」 | ✅ |
| Web 视图 | 超管总览/成员双 Tab/组织视图/面板三档 | P1 | skill-permissions.test.ts（4 处） | ✅ |
| CLI --manage 解析 | resolveShareTarget | P1 | share.test.ts「grants manage…--manage」「rejects combining --write and --manage」 | ✅ 2026-09-08 |

## 覆盖缺口（GAP）与决策

| ID | 缺口 | 风险×努力 | 决策 | 位置 | 状态 |
|----|------|-----------|------|------|------|
| G1 | CLI `share --manage` → `add_member manage` | 高×低 | 写测试（DO FIRST） | cli/tests/share.test.ts | ✅ 2026-09-08 |
| G2 | 团队创建 manage 档 → createTeam('admin')；GET teams 归一化 'manage' | 高×低 | 写测试 | server/tests/org-console.test.ts | ✅ |
| G4 | 组织管理员 publish（行为变化：owner/org-admin 现可 publish） | 高×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G6 | 超管读私有技能（search + skill info） | 高×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G7 | inventory 匿名 → 401 | 中×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G3 | add_member 拒绝 Gitea 词汇 'admin'（ESL 词汇边界） | 中×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G5 | archive 守门：manage 可执行、write 拒绝 | 中×低 | 写测试（archive 作代表） | server/tests/rbac-permissions.test.ts | ✅ |
| G10 | remove_member 撤销 manage 后失去管理权 | 中×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G11 | 矩阵中团队 admin 档显示 'manage' | 中×低 | 写测试 | server/tests/rbac-permissions.test.ts | ✅ |
| G8 | write 团队 → inventory access 'write' | 低×低 | DEFER（读/写团队由 G6/G10 间接覆盖） | — | ⏸ 暂缓 |
| G9 | maintainers_json 非创建者 manage | 低×低 | DEFER（legacy 兼容路径） | — | ⏸ 暂缓 |

## 努力预算（solo Dev，单位：小时）

| 活动 | 估算 | 说明 |
|------|------|------|
| G1–G7 测试编写 + 运行 | 3.0 | 每项 15–30min，复用现有 mock 工厂 |
| G5/G10/G11 测试编写 | 1.0 | archive 守门 + 撤销 + 归一化 |
| **计划工作量** | **4.0** | 70% |
| **Bug 验证/重测缓冲** | **1.5** | 30% |
| **合计** | **5.5** | 单日窗口，含缓冲 |

## 时间线（单日 sprint）

- **上午**：G1–G4（CLI、团队、org-admin publish、超管读）
- **下午**：G5–G7、G10–G11；末段全量回归（`npm test` 三套 + build）
- **验证门禁**：`npx vitest run`（server/cli/web）+ `npm run build` 全绿

## Entry / Exit

- **Entry**：实现已合入工作区；基线套件全绿（server 321 / cli 221 / web 81）；mock 工厂可用。
- **Exit**：G1–G7、G10–G11 全部新增用例绿；无 GAP 未标注；三套 + build 全绿；覆盖矩阵无新增未决策缺口。

## 计划风险

1. mock 工厂与真实 Gitea 语义偏差（如 collaborator permission 对非协作者返回），已靠 `?? 'none'` 修正一次——新用例沿用该约定。
2. G5 中 rename 路由依赖 renameRepo mock 缺失，改用 archive 作守门代表，避免 mock 膨胀。
