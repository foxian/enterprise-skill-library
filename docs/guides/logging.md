# ESL Server 日志

本文说明 `@esl/server` 诊断日志的输出契约、查看方式与文件留存边界。日志用于
排查请求、鉴权、数据库、Git Backend 与后台任务问题，不是正式审计记录，也不是
CLI 或 Web 的用户可见文案。

## 输出契约

- 生产环境输出 JSON Lines：每行一条 JSON 日志。
- `msg` 是固定英文短句，便于检索；它不随请求 locale 翻译。
- 时间戳使用 UTC。查看时如需本地时间，由日志工具或查询命令转换。
- 结构化字段保持机器可读，常用字段包括：
  - `event`：稳定事件名，如 `skill.published`、`server.started`。
  - `outcome`：`succeeded`、`failed` 等结果。
  - `actorId` / `actorUsername`：触发操作的主体。
  - `organization` / `resourceType` / `resourceId`：资源定位。
  - `durationMs`：耗时。
  - `errorCode`：与 API Error Code 对齐的稳定错误码。
  - `err`：5xx 或基础设施异常的错误对象与堆栈。
- 事件名使用小写点分命名，不复用 i18n 翻译键；两者即使相似也不是同一个契约。
- 默认日志级别为 `info`。`LOG_LEVEL` 支持
  `trace|debug|info|warn|error|fatal`，非法值会导致服务启动失败。

示例：

```json
{"level":"info","time":"2026-09-20T08:30:00.123Z","event":"skill.published","outcome":"succeeded","actorUsername":"alice","organization":"acme","resourceType":"skill","resourceId":"sk_01J...","durationMs":183}
```

## HTTP 请求日志

Fastify 会输出请求完成日志，包含请求方法、路径、状态码与耗时。`/health` 不输出
请求日志，避免健康检查刷屏。业务路由不额外重复记录访问日志。

请求 ID 由服务端生成并记录在请求日志中。当前不接受外部请求 ID header，避免调用方
伪造或污染关联键。

## 敏感信息

日志默认禁止包含：

- 密码
- token
- Authorization header
- Cookie
- 完整请求体
- 完整请求 headers

可以记录用户名、组织名、技能名、请求路径、状态码、耗时与错误类型。实现上同时使用
字段白名单与 Pino redact，避免新增字段时意外带入凭据。

## 本地查看

查看 API 容器日志：

```powershell
docker compose logs -f api
```

按时间过滤：

```powershell
docker compose logs --since 2026-09-20T00:00:00Z api
```

开发时可用 `pino-pretty` 把 JSON Lines 转为人类可读输出：

```powershell
docker compose logs api | npm exec -- pino-pretty
```

`pino-pretty` 只用于开发查看，不改变生产 JSON 输出。

## 文件留存与轮转

ESL API 不在进程内创建日志文件，也不实现按日轮转。应用只保证 stdout/stderr 中
的 JSON Lines 稳定；采集、按日期归档、压缩与保留策略由部署层负责。

本地 Docker Compose 建议为 `api` 配置大小与文件数量上限，例如：

```yaml
services:
  api:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

`json-file` 驱动按大小轮转，不按日期命名文件。如果需要按日期查询，优先使用日志
时间戳或 `docker compose logs --since`；如果需要按日期归档，使用部署层采集器。

Linux 部署可以把服务 stdout 交给 systemd 或日志采集器，再用 logrotate 或采集器
策略完成按日归档。以下示例假设进程管理器已将 API stdout 写入
`/var/log/esl/api.log`：

```text
/var/log/esl/api.log {
    daily
    rotate 30
    dateext
    compress
    missingok
    notifempty
    copytruncate
}
```

该配置会生成类似 `api.log-20260920.gz` 的日期文件，并保留 30 天。实际保留天数、
压缩策略与轮转时区应随部署环境统一配置；不要让每个应用进程各自维护一套规则。

## 排障建议

- 先按 `requestId` 聚合同一请求的日志。
- 5xx 优先查看 `err` 与 `errorCode`，再结合请求完成日志确认状态码和耗时。
- Git Backend 故障查看 `dependency=gitea` 的失败或慢调用记录。
- 数据库问题查看打开、schema、事务、锁与慢操作日志；日志中不应出现 SQL 参数。
- 需要正式审计结论时，不要把诊断日志当作证据链；应另行设计审计系统。
