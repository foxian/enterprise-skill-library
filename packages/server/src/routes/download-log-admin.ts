import { apiError } from '../errors.js';
import type { FastifyInstance } from 'fastify';
import type { DownloadLogQuery, DownloadLogRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { requireSuperAdministrator } from './org-admin.js';

export interface DownloadLogAdminRouteOptions {
  giteaService: GiteaService;
  downloadLogRepository: DownloadLogRepository;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
// 页码也要有上限：OFFSET = (page - 1) * pageSize，无上限的 page 会让偏移量越过
// Number.MAX_SAFE_INTEGER，绑定给 SQLite 时被当成浮点静默取整。
const MAX_PAGE = 100_000;

// 下载日志明细查询（ADR-0067）：明细含用户名与截断 IP 段，属可识别个人的行为
// 画像，仅 Super Administrator 可查——技能 Owner 与普通用户不可查，其统计需求
// 由公开的聚合下载量满足。非超管返回 403。
export function registerDownloadLogAdminRoutes(
  app: FastifyInstance,
  options: DownloadLogAdminRouteOptions
): void {
  const { giteaService, downloadLogRepository } = options;

  app.get('/api/admin/download-logs', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const parsed = parseDownloadLogQuery(request.query as Record<string, string | undefined>);
    if ('error' in parsed) {
      return reply.status(400).send(apiError('invalidDownloadLogQuery', { detail: parsed.error }));
    }
    // 回显分页元数据，使调用方不必自己记住请求里的 page/pageSize。
    const { items, total } = downloadLogRepository.queryLogs(parsed.value);
    return { items, total, page: parsed.value.page, pageSize: parsed.value.pageSize };
  });
}

function parseDownloadLogQuery(
  query: Record<string, string | undefined>
): { value: DownloadLogQuery } | { error: string } {
  const result = query.result?.trim() || undefined;
  if (result !== undefined && result !== 'success' && result !== 'failure') {
    return { error: 'result must be success or failure' };
  }
  const from = parseInstant(query.from);
  if (from === null) return { error: 'from must be an ISO 8601 timestamp' };
  const to = parseInstant(query.to);
  if (to === null) return { error: 'to must be an ISO 8601 timestamp' };
  if (from !== undefined && to !== undefined && from > to) {
    return { error: 'from must not be later than to' };
  }
  const page = parsePositiveInteger(query.page);
  if (page === null || (page !== undefined && page > MAX_PAGE)) {
    return { error: `page must be a positive integer no greater than ${MAX_PAGE}` };
  }
  const pageSize = parsePositiveInteger(query.pageSize);
  if (pageSize === null || (pageSize !== undefined && pageSize > MAX_PAGE_SIZE)) {
    return { error: `pageSize must be a positive integer no greater than ${MAX_PAGE_SIZE}` };
  }
  return {
    value: {
      skill: query.skill?.trim() || undefined,
      username: query.username?.trim() || undefined,
      result: result as 'success' | 'failure' | undefined,
      from,
      to,
      page: page ?? 1,
      pageSize: pageSize ?? DEFAULT_PAGE_SIZE
    }
  };
}

// 归一化为 ISO 8601 UTC：返回 undefined 表示未提供，null 表示无法解析。
function parseInstant(value: string | undefined): string | undefined | null {
  if (value === undefined || value.trim() === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePositiveInteger(value: string | undefined): number | undefined | null {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
