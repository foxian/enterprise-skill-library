import { pino, type DestinationStream, type Logger } from 'pino';

// 诊断日志级别（ADR-0045）：运行时只暴露 LOG_LEVEL，合法值即 Pino 标准级别。
// 这份清单是配置校验与 logger 创建共用的唯一来源。
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

// 结构化字段白名单（ADR-0045）：调用方传进来的键只有这些会进入日志，其余一律
// 丢弃。白名单是「默认最小化记录用户数据」的第一道防线——新增字段必须显式
// 在此登记，不会因为随手多传一个键而泄露。
export const DIAGNOSTIC_FIELDS = [
  'event',
  'outcome',
  'actorId',
  'actorUsername',
  'organization',
  'resourceType',
  'resourceId',
  'durationMs',
  'errorCode',
  'dependency',
  'operation',
  'method',
  'statusCode',
  'slow',
  'port',
  'taskId',
  'triggerRequestId'
] as const;

export type DiagnosticFieldName = (typeof DIAGNOSTIC_FIELDS)[number];

// 稳定事件字段契约（ADR-0045）。事件名是小写点分技术标识，不是 i18n 翻译键。
export interface DiagnosticFields {
  event: string;
  outcome?: 'succeeded' | 'failed';
  actorId?: string;
  actorUsername?: string;
  organization?: string;
  resourceType?: string;
  resourceId?: string;
  durationMs?: number;
  errorCode?: string;
  dependency?: string;
  operation?: string;
  method?: string;
  statusCode?: number;
  slow?: boolean;
  port?: number;
  taskId?: string;
  triggerRequestId?: string;
  /** Pino serializes this as `err` (type/message/stack) on 5xx and infrastructure failures. */
  err?: unknown;
}

// redact 是白名单之外的第二道防线（ADR-0045）：白名单挡住我们自己传的键，
// redact 挡住 Fastify/Pino 生成的记录以及 error 对象上附带的凭据字段。
const REDACT_PATHS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'secret',
  'headers.authorization',
  'headers.cookie',
  'headers.password',
  'headers.token',
  'body.password',
  'body.token',
  '*.password',
  '*.token',
  '*.authorization',
  '*.cookie',
  '*.secret',
  '*.*.password',
  '*.*.token',
  '*.*.authorization',
  '*.*.cookie'
];

export const REDACTION_CENSOR = '[redacted]';

// 请求日志只保留诊断需要的定位信息：方法、路径、状态码、请求标识。路径去掉
// query，避免 token 或一次性参数经 URL 进入日志；headers 与 body 一律不记录
// （ADR-0045）。
function requestSerializer(request: { method?: string; url?: string }): Record<string, unknown> {
  const url = request.url ?? '';
  return {
    method: request.method,
    url: url.split('?')[0]
  };
}

function responseSerializer(reply: { statusCode?: number }): Record<string, unknown> {
  return { statusCode: reply.statusCode };
}

export interface CreateLoggerOptions {
  level: LogLevel;
  /** Override the sink. Production keeps the Pino default (stdout). */
  destination?: DestinationStream;
}

// 生产 logger：JSON Lines 到 stdout，UTC ISO-8601 时间戳（ADR-0045）。
// 不创建日志文件、不做轮转——文件路径、按日归档与保留期限归部署层。
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { req: requestSerializer, res: responseSerializer },
      redact: { paths: REDACT_PATHS, censor: REDACTION_CENSOR }
    },
    options.destination
  );
}

// 显式静默的 logger（US46）：让不关心日志的调用方拿到真实 Logger 接口但
// 不产生任何输出。silent 不是合法 LOG_LEVEL，只作为代码内的开关存在。
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}

// 业务与基础设施事件的最小 logger 契约：Fastify 的 request.log 与 Pino 的
// Logger 都满足它，调用方不需要关心自己拿到的是哪一种。
export interface DiagnosticLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  child(bindings: Record<string, unknown>): DiagnosticLogger;
}

export type DiagnosticLevel = Exclude<LogLevel, 'trace' | 'fatal' | 'silent'>;

// 后台任务的子 logger（ADR-0045）。绑定只允许白名单里的关联字段——taskId 与
// triggerRequestId：请求内任务挂 request.log，请求结束后继续执行的任务只带这两
// 个标识，不继承请求期的其余上下文；独立系统任务挂应用级 logger，没有触发请求。
export function taskLogger(
  parent: DiagnosticLogger,
  taskId: string,
  triggerRequestId?: string
): DiagnosticLogger {
  return parent.child({
    taskId,
    ...(triggerRequestId ? { triggerRequestId } : {})
  });
}

// 每次后台任务执行都记录 started / succeeded / failed（US40），失败时携带
// 结构化错误对象，便于确认任务生命周期与根因。logger 可缺省，未接入时静默。
export function logTaskStarted(
  logger: DiagnosticLogger | undefined,
  taskId: string,
  message: string
): void {
  logEvent(logger, 'info', { event: 'task.started', taskId }, message);
}

export function logTaskFinished(
  logger: DiagnosticLogger | undefined,
  taskId: string,
  error?: unknown
): void {
  if (error === undefined) {
    logEvent(
      logger,
      'info',
      { event: 'task.succeeded', outcome: 'succeeded', taskId },
      'Background task succeeded'
    );
    return;
  }
  logEvent(
    logger,
    'error',
    { event: 'task.failed', outcome: 'failed', taskId, err: error },
    'Background task failed'
  );
}

// 唯一的业务事件出口：字段白名单在这里落实，msg 保持固定英文。
// logger 允许缺省——数据访问层等可复用的模块在未接入日志时保持静默，而不是
// 强迫每个调用方写 if。
export function logEvent(
  logger: DiagnosticLogger | undefined,
  level: DiagnosticLevel,
  fields: DiagnosticFields,
  msg: string
): void {
  if (!logger) {
    return;
  }
  const payload: Record<string, unknown> = {};
  const supplied = fields as unknown as Record<string, unknown>;
  for (const name of DIAGNOSTIC_FIELDS) {
    const value = supplied[name];
    if (value !== undefined) {
      payload[name] = value;
    }
  }
  if (fields.err !== undefined) {
    payload.err = fields.err;
  }
  logger[level](payload, msg);
}
