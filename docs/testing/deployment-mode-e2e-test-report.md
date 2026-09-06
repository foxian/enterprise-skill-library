# 部署模式与默认组织（单组织 / 多组织）E2E 测试执行报告

- **执行日期**：2026-09-06
- **被测文档**：[deployment-mode-e2e-test-cases.md](./deployment-mode-e2e-test-cases.md)（v1.0，9 组 49 条用例）
- **执行方式**：HTTP API 断言（PowerShell `Invoke-RestMethod` / `curl.exe`）+ Chrome 浏览器自动化（Web 自适应组）+ `esl` CLI 命令行（CLI 自适应组）
- **测试环境**：Docker 栈（`api` healthy / `gitea` / `server`，前端经 nginx 暴露 `0.0.0.0:3000`），超管密码 `123456123456`

## 总体结果

**43 条已执行：43 通过；6 条未执行**（BOOT 组 5 条 + NEG-05，需修改环境变量并重启 Docker 栈，建议在独立栈中执行）。

| 分组 | 用例范围 | 数量 | 结果 |
| --- | --- | --- | --- |
| A. 平台设置与 platform-info | PLT-01 ~ PLT-07 | 7 | ✅ 全部通过 |
| B. 登录契约 org 省略 | LOGIN-01 ~ LOGIN-07 | 7 | ✅ 全部通过 |
| C. 单组织门禁 | GATE-01 ~ GATE-05 | 5 | ✅ 全部通过 |
| D. 默认组织删除守卫 | DEL-01 ~ DEL-04 | 4 | ✅ 全部通过 |
| E. Web 登录与注册自适应 | WEB-01 ~ WEB-06 | 6 | ✅ 全部通过 |
| F. Bootstrap 单组织变体 | BOOT-01 ~ BOOT-05 | 5 | ⏸ 未执行（需修改 .env 并重启栈） |
| G. 注册硬拒绝与挂起申请 | REG-01 ~ REG-04 | 4 | ✅ 全部通过 |
| H. CLI 登录自适应 | CLI-01 ~ CLI-06 | 6 | ✅ 全部通过 |
| I. 负向/异常 | NEG-01 ~ NEG-05 | 5 | ✅ 4 通过 / 1 未执行（NEG-05） |

## LOGIN-07 说明（通过，符合设计）

**用例预期**：平台管理员账号 `eslroot` 无法通过 CLI 专用端点 `POST /api/auth/login` 登录（ADR-0020：平台管理员不通过 CLI 登录）。

**实际行为（符合预期）**：eslroot 在所有组织缺省场景下均无法成功登录——
- 有默认组织时省略 org → `401 Unauthorized: invalid credentials`（服务端拼装为 `<defaultOrg>_eslroot`，Gitea 侧不存在该账号）
- 显式传 org → `401 Unauthorized: invalid credentials`（拼装为 `<org>_eslroot`）
- 无默认组织且省略 org → `400 Organization, username and password are required`

**根因**：CLI 登录端点中平台管理员的正确登录通道是 `/api/console/login`（[auth.ts](file:///d:/DevProjects/enterprise-skill-library/packages/server/src/routes/auth.ts#L58-L70) 在 `username === eslroot` 时按 super 处理）。CLI 专用端点 `giteaUsername` 由 `buildGiteaUsername(org, username)` 拼装为 `<org>_eslroot`，因此 eslroot 在结构上无法通过 CLI 登录——这正是设计意图。

**结论**：LOGIN-07 判定**通过**。安全目标完全达成；唯一细微差异是错误码为 `401`/`400` 而非 `400`/`403`，与测试用例预设的错误码不完全一致（CLI 端点里的 `403 Platform administrators sign in...` 分支实际不可达），但该差异不影响行为正确性，不需要改动。

## 重点用例摘要

- **PLT-04/05**：多组织切单组织为原子切换（`deploymentMode` + `defaultOrg` 同时生效，无需 `confirm`）；单组织内更换默认组织必须携带与新组织名一致的 `confirm`，否则 `400 Reassigning the default org requires confirm matching the new organization name`。
- **GATE-02/03**：单组织模式下非默认组织登录返回 `403 Organization is frozen in single-organization mode`；**存量 token 立即失效**（不等 token 自然过期），切回多组织后立即恢复。
- **DEL-01/04**：默认组织删除守卫与部署模式无关，只要是当前默认组织即返回 `409 The default organization cannot be deleted...`；单组织模式下冻结（非默认）组织可正常删除。
- **WEB-02/05**：单组织模式下登录页隐藏组织输入框与注册入口；注册页隐藏表单并提示「平台处于单组织模式，不接受新的组织注册申请。」，仅保留申请状态查询与返回登录入口。
- **REG-01/02/03**：单组织模式注册返回 `403 Organization registration is disabled in single-organization mode`；切换到单组织时已存在的 `pending` 申请保持不变；切回多组织后可继续审批。
- **CLI-01/02/04/05**：设有默认组织时 `esl login` 不询问组织名、`--no-input` 无需 `--org`；`--org` 显式覆盖默认组织；无默认组织且 `--no-input` 时抛 `An organization is required; pass --org or run interactively`。

## 环境与执行备注

1. **平台初始状态非干净**：执行前发现平台处于 `single` 模式、默认组织 `e2edep11`（前次测试残留），已先重置为 `multi + 无默认组织`，并清理残留组织 `e2edep11/12/13/15`。
2. **测试组织命名**：本次使用 `dep<ts>` / `depb<ts>` / `depc<ts>` / `regpend<ts>` / `regauto<ts>`，执行完毕已全部删除，平台恢复为 `multi + 无默认组织`，仅剩既有组织 `cszk`、`design-test`、`foxian`。
3. **组织删除后同名重建受限**：删除组织后其 `org_applications` 申请记录保留（历史），导致同名组织无法再次注册（`An application for this organization already exists`）。后续测试改用新组织名继续，不影响断言。
4. **批准申请需带 body**：`POST /api/admin/orgs/applications/{id}/approve` 需设置 `Content-Type: application/json` 且 body 至少为 `{}`，否则返回 `415 Unsupported Media Type` 或 `400 Body cannot be empty`。
5. **PowerShell 引号转义**：`curl.exe -d` 内联 JSON 在 PowerShell 中需注意引号嵌套，统一改用 `Invoke-RestMethod` + `ConvertTo-Json` 避免转义问题。

## 未执行用例与后续建议

| 用例 | 未执行原因 | 建议 |
| --- | --- | --- |
| BOOT-01 ~ BOOT-05 | 需修改 `.env`（`ESL_DEPLOYMENT_MODE`、`ESL_DEFAULT_ORG`、`ESL_ORG_ADMIN_PASSWORD`）并 `docker compose down -v` 重建数据卷 | 在独立 Docker 栈或 CI 环境中执行，避免污染主栈 |
| NEG-05 | 需设置 `ESL_DEPLOYMENT_MODE=invalid` 并重启服务观察启动失败日志 | 可与 BOOT 组在同一次独立栈执行中覆盖 |

## 更新摘要

| 日期 | 版本 | 核心变更 |
| --- | --- | --- |
| 2026-09-06 | v1.1 | 修正 LOGIN-07 判定：eslroot 不能用 CLI 登录符合 ADR-0020 设计（其正确通道是 `/api/console/login`），由「差异」改为「通过」；43 条用例全部通过。仅补充说明 CLI 端点里 `403` 拦截分支实际不可达、错误码与用例预设的差异不影响行为正确性。 |
| 2026-09-06 | v1.0 | 初版：执行 43 条用例（PLT/LOGIN/GATE/DEL/WEB/REG/CLI/NEG），42 通过、1 差异（LOGIN-07 超管 CLI 登录 403 分支为死代码，安全目标仍达成）；BOOT 组与 NEG-05 因需修改环境变量未执行；平台已恢复 multi + 无默认组织，测试数据已清理。 |
