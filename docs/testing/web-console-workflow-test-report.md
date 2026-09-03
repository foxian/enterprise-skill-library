# ESL 管理后台（Web Console）工作流测试执行报告（Issue #15–#22）

- **执行日期**：2026-09-03
- **被测文档**：[web-console-workflow-test-cases.md](./web-console-workflow-test-cases.md)（v1.0，29 条用例）
- **执行方式**：Chrome DevTools MCP 浏览器自动化 + API 级断言（容器内 `node -e` / 脚本）
- **测试环境**：Docker 栈（`api` healthy / `gitea` / `server`，前端经 nginx 暴露 `0.0.0.0:3000`）

## 总体结果

**29 / 29 全部通过**，未发现产品代码缺陷。

| 分组 | 用例范围 | 数量 | 结果 |
| --- | --- | --- | --- |
| A. 注册与 Provisioning 状态机 | AUTH-12 ~ AUTH-18 | 7 | ✅ 全部通过 |
| B. 超管：组织状态/审批/重试/删除 | SUPER-11 ~ SUPER-18 | 8 | ✅ 全部通过 |
| C. 成员生命周期 | ORG-15 ~ ORG-21 | 7 | ✅ 全部通过 |
| D. 端到端全生命周期回归 | E2E-02 | 1 | ✅ 通过 |
| E. 负向/异常 | NEG-07 ~ NEG-12 | 6 | ✅ 全部通过 |

## 环境问题记录（非代码缺陷）

| 问题 | 现象 | 处置 |
| --- | --- | --- |
| api 镜像陈旧 | 运行中的 api 镜像构建于 31 小时前，缺 `tenant_organizations`/`operations` 等新表 | 重建 api 镜像并重启，迁移自动建表 |
| `ESL_APPLICATION_ENCRYPTION_KEY` 未配置 | 注册/建成员接口返回 503 | 在 `.env` / Docker Secret 配置 32 字节密钥 |
| 容器重建丢 `/tmp` | 拷入容器的临时脚本随容器重建丢失 | 改用 bind-mount 目录（`data/api` → `/data`）持久放置 |
| PowerShell 引号转义 | `node -e '...'` 单引号不生效、JSON 参数转义复杂 | 脚本落盘为 `.cjs`/`.mjs` 后 `docker compose cp` 执行 |
| 登录请求格式 | API 直测时 `username` 需传完整 Gitea 用户名 `<org>_<username>`（前端会自动拼接）；token 头为 `Authorization: token <token>` | 修正测试请求格式 |

## 重点用例摘要

- **AUTH-15/16**：auto 模式注册返回 `201 { status: "provisioning" }` 并显示「组织正在开通」；manual 模式返回 `201 { status: "pending" }`，与状态机一致。
- **SUPER-13/15**：DB 种子构造 `failed`/`delete_failed` 后，重试按钮可恢复流程并幂等推进至 `active`/`deleted`。
- **SUPER-16**：legacy 申请（无密文）审批走兼容路径，一次性密码仅在关闭弹窗前可见，列表接口无凭据字段。
- **SUPER-18 / ORG-21**：重复删除/重复添加成员返回同一 `operationId`（幂等键生效），无重复副作用。
- **E2E-02**：注册（provisioning）→ active → 添加/登录成员 → 超管确认 → 删除（deleting → 移除）全链路通过，无残留数据。
- **NEG-07/08**：非 active 组织登录返回 `409`，业务接口（成员/技能/权限）均被 preHandler 拦截。
- **NEG-12**：申请列表、状态查询、审计接口、组织列表响应均未发现 `encrypted_password`/`hashed_password`/`password`/token 等泄露字段。

## NEG-09 专项说明（初测异常已排除）

首轮执行时曾观察到「11 位密码注册返回 `201`」（预期 `400`）。复查结论：

1. 宿主源码 [account-policy.ts](file:///d:/DevProjects/enterprise-skill-library/packages/core/src/org/account-policy.ts) 正确（`DEFAULT_PASSWORD_MIN_LENGTH = 12`）。
2. 容器内 `/app/packages/core/dist/org/account-policy.js` 编译产物与源码一致。
3. api 容器重建后实测，全部 NEG-09 子项均返回 `400`：
   - 11 位密码注册 → `400 password must be at least 12 characters`
   - 大写/超长/保留字组织名 → `400`（各自明确错误文案）
   - 成员接口：大写/空格/超长用户名、短密码 → 均 `400`

**结论**：初测异常为 api 容器旧构建产物所致的环境问题，随镜像重建消除；服务端最终校验逻辑无缺陷。

## 遗留与建议

1. 测试数据已清理：种子组织状态均已恢复/删除（`wfa`、`wfb`、`wfidem`、`wf113053`、`wf113521`、`wfneg9*` 等已删除；`wfsl` 为已批准的 legacy 历史申请，保留）。
2. 基线文档 [web-console-e2e-test-cases.md](./web-console-e2e-test-cases.md) 中 AUTH-06/07、SUPER-07、ORG-02~06 的旧断言与本批新行为不一致，建议按测试文档「对既有基线用例的影响」表更新。
3. DB 种子依赖 `data/api/esl.db` 的手工修改，仅用于测试环境；生产环境不应存在直接改库路径。
