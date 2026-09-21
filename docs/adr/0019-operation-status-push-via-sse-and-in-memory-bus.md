# Operation 状态推送使用 SSE 与进程内事件总线

Status: accepted

前端需要感知跨系统 Operation 的完成/失败（如组织注册后的后台开通），而不是反复轮询。选择 Server-Sent Events（SSE）与进程内订阅总线：`OperationExecutor` 在操作 settle（`succeeded` / `permanently_failed`）时通过 `OperationEventBus` 发布事件，SSE 端点 `GET /api/operations/:id/stream` 向订阅方推送状态。这是单向状态通知场景的标准解，无需 WebSocket 的双向通道；当前部署为单实例单进程，进程内 `Map<operationId, listeners>` 即可，不需要跨进程 pub/sub（跨实例化时再引入消息总线）。

## Consequences

- 鉴权双通道：登录用户走 token（Operation 发起者或平台管理员，与 `GET /api/operations/:id` 一致）；`organization.provision` 额外允许申请人凭申请时设置的初始密码（`X-Org-Password` 头）订阅自己的开通流，与现有 `POST /api/orgs/applications/:orgName/status` 同源，不向匿名申请人暴露通用查询能力。
- 事件负载为 `{ operationId, status, error? }`（错误已脱敏）。`failed` 是可重试中间态，也会推送；前端只把 `succeeded` / `permanently_failed` 视为终态。
- 连接建立时先推送当前状态，之后由执行器 settle 时增量推送；订阅表在内存中，进程重启即丢失，SSE 客户端可重连（重新订阅会立即收到当前状态）。
- SSE 经 nginx 反代需要响应头 `X-Accel-Buffering: no` 关缓冲，并以 15 秒心跳避免触发 `proxy_read_timeout`（默认 60s）断开空闲连接。
- 前端用 `fetch` + `ReadableStream` 解析 SSE：原生 `EventSource` 无法携带自定义 `Authorization` / `X-Org-Password` 头。
