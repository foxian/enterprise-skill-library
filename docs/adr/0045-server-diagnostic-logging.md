# ESL Server 诊断日志

Status: accepted

ESL Server 需要可检索的运行日志来排查请求、鉴权、数据库、Git Backend 与后台任务
问题，同时不能把敏感凭据写入日志或让日志无限占用磁盘。为此，`@esl/server`
采用 Fastify 原生集成的 Pino 输出结构化 JSON Lines；生产环境默认只写
stdout/stderr，由部署层负责采集、按日期归档、轮转与保留策略。应用不默认管理
日志文件路径，也不在进程内实现日志轮转。

## 决策

- 日志范围仅限 `@esl/server`；CLI 输出、Web 展示与服务端诊断日志保持分离。
- 日志定位为运行诊断记录，不作为不可篡改的审计系统；安全相关事件仍可用结构化
  字段记录「谁、何时、做了什么、结果如何」。
- 服务端使用 Fastify 内置 Pino logger；生产输出为 JSON Lines，本地开发可通过
  `pino-pretty` 在管道外改善可读性。
- 运行时只暴露 `LOG_LEVEL`，合法值为 `trace|debug|info|warn|error|fatal`，默认
  `info`；非法值在启动配置解析阶段直接失败。
- 文件路径、按日期命名、轮转、压缩与保留期限由部署层负责。Docker、systemd、
  journald、logrotate 或日志平台可以选择自己的采集与留存方案，但应用不承诺
  生成特定文件名。
- 日志事件使用稳定的机器可读字段：`event`、`outcome`、`actorId`、
  `actorUsername`、`organization`、`resourceType`、`resourceId`、`durationMs`、
  `errorCode`。事件名为小写点分技术标识，例如 `skill.published`。
- 启用 Fastify 请求完成日志，`/health` 保持静默；业务路由不再重复输出访问日志。
  请求 ID 由 Fastify 自生成，暂不接受外部请求 ID header。
- 普通 4xx 依赖请求完成日志；安全拒绝可记录 `warn`；5xx 统一携带 `err` 字段并
  避免路由、服务与全局错误处理重复输出。
- Git Backend 成功调用只记录 `debug`；失败与慢调用记录 `dependency=gitea`、
  `operation`、`method`、`statusCode`、`durationMs`、`outcome` 与 `errorCode`。
- SQLite 日志不记录 SQL 与参数，只记录打开、schema、事务、锁、损坏与批量初始化
  等异常或慢操作。
- 后台任务在请求上下文内使用 `request.log.child`；请求结束后继续的任务只继承
  安全字段、`taskId` 与 `triggerRequestId`；独立系统任务使用 `app.log.child`。
- 默认禁止记录密码、token、Authorization、Cookie、完整请求体与完整 headers；
  采用字段白名单加 Pino redact 双重保护。
- 日志遵守 ADR-0044 的机器可读边界：`msg` 保持固定英文，结构化字段、事件名与
  `errorCode` 不随 locale 变化；用户创建的组织名、用户名与技能名保持原文。
- 日志时间戳使用 UTC；按哪个时区切分日志文件由部署层显式配置。
- 配置解析、token 文件读取与 Git Backend token 校验失败发生在 logger 创建之前，
  由入口进程输出一条 stderr 诊断并以非零码退出；Fastify app 创建后的生命周期事件
  使用 `server.started`、`server.start.failed`、`server.stopped` 与
  `server.stop.failed`。

## 考虑过的方案

- 在应用内使用 Pino file transport 并自行按日轮转：能直接满足本地文件需求，但把
  磁盘治理、压缩、保留、容器重启与多实例写入问题引入 API 进程，与部署层已有
  日志能力重叠。
- 单独开发日志框架：需要重复解决序列化、级别、脱敏、请求关联与性能问题，没有
  对应收益。
- 继续使用 `console.log` / `console.error`：无法提供稳定结构化字段、级别控制、
  redact 与请求关联。

## 后果

- 生产部署必须显式决定日志采集方式；未配置采集时日志仍会进入容器 stdout，但
  不会自动形成按日期归档的文件。
- 本地 Docker Compose 应为 `api` 服务配置日志大小与文件数量上限，避免开发环境
  磁盘被占满；具体运维方式见[日志指南](../guides/logging.md)。
- `pino-pretty` 只作为开发依赖用于查看日志，不进入生产依赖，也不通过应用配置
  自动启用。
- 若未来需要正式审计日志，应另行设计不可篡改性与保留策略，不把本诊断日志
  重新解释成审计系统。
