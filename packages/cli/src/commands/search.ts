import {
  apiUrl,
  fetchWithTimeout,
  resolveOptionalFreshToken,
  type NetworkCommandOptions,
  resolveNetworkConfig
} from './network-options.js';
import { isBuiltinIdentity } from '@esl/core';
import { requireOkResponse } from '../api-error.js';

export interface SkillSearchResult {
  name: string;
  /** 对外当前显示名（ADR-0048）：标题位优先显示名，name 作技术名。 */
  displayName?: string;
  description: string;
  scope?: string;
  skillName?: string;
  latestStableVersion?: string;
  visibility?: string;
}

export interface SkillSearchFilters {
  query?: string;
  namespace?: string;
  keyword?: string;
  visibility?: 'public' | 'private';
  limit?: number;
}

export async function executeSearch(
  query: string | undefined,
  options: NetworkCommandOptions = {}
): Promise<SkillSearchResult[]> {
  const fetchImpl = options.customFetch ?? fetch;
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  // 与 info 对齐（ADR-0049）：存在有效登录态则随请求携带 Skill User Token，
  // 匿名仍可浏览 public 已发布技能。
  const token = await resolveOptionalFreshToken({ homeDir: options.homeDir });
  const filters = new URLSearchParams();
  if (query !== undefined && query !== '') {
    filters.set('q', query);
  }
  const searchOptions = options as NetworkCommandOptions & SkillSearchFilters;
  if (searchOptions.visibility === 'private' && !token) {
    throw new Error('Searching private skills requires login; run "esl login" first');
  }
  if (searchOptions.namespace) filters.set('namespace', searchOptions.namespace);
  if (searchOptions.keyword) filters.set('keyword', searchOptions.keyword);
  if (searchOptions.visibility) filters.set('visibility', searchOptions.visibility);
  if (searchOptions.limit !== undefined) filters.set('limit', String(searchOptions.limit));
  const queryString = filters.toString();
  const res = await fetchWithTimeout(
    fetchImpl,
    apiUrl(server, `/api/skills/search${queryString ? `?${queryString}` : ''}`),
    { headers: token ? { Authorization: `token ${token}` } : {} }
  );

  if (!res.ok) {
    await requireOkResponse(res, 'Failed to search skills');
  }

  const results = (await res.json()) as SkillSearchResult[];
  return results.filter((result) => !isBuiltinIdentity(result.name));
}
