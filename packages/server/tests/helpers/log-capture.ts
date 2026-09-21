import type { Logger } from 'pino';
import { createLogger, type LogLevel } from '../../src/logging.js';

export interface LogCapture {
  logger: Logger;
  /** Raw JSON Lines exactly as written to stdout, for line-shape assertions. */
  lines: string[];
  /** Parsed records, in write order. */
  records: Record<string, unknown>[];
}

// 日志专项测试的注入点（ADR-0045）：把应用 logger 指向内存而不是 stdout。
// 这里刻意走真实的 createLogger()，让 Pino 的 redact 与序列化真正执行——
// 用手搓的假 logger 会让脱敏测试变成同义反复（redact 配置根本不会跑）。
export function createLogCapture(level: LogLevel = 'trace'): LogCapture {
  const lines: string[] = [];
  const records: Record<string, unknown>[] = [];
  const logger = createLogger({
    level,
    destination: {
      write(line: string): void {
        lines.push(line);
        records.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
  });
  return { logger, lines, records };
}

/** Records carrying the given diagnostic event name. */
export function recordsForEvent(capture: LogCapture, event: string): Record<string, unknown>[] {
  return capture.records.filter((record) => record.event === event);
}

// 只属于某次 HTTP 请求的记录（带 reqId）。应用启动期的系统记录——SQLite 打开与
// schema 初始化——没有请求标识，属于另一条时间线，不该被请求级断言误伤。
export function requestRecords(capture: LogCapture): Record<string, unknown>[] {
  return capture.records.filter((record) => record.reqId !== undefined);
}

/** Records written at the given pino numeric level (40 = warn, 50 = error). */
export function recordsAtLevel(capture: LogCapture, level: number): Record<string, unknown>[] {
  return capture.records.filter((record) => record.level === level);
}
