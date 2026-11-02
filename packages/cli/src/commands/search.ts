import {
  apiUrl,
  fetchWithTimeout,
  resolveOptionalFreshToken,
  type NetworkCommandOptions,
  resolveNetworkConfig
} from './network-options.js';
import { isBuiltinIdentity, type SkillVisibility } from '@esl/core';
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
  /** 跨版本累计下载量（#137）：从未下载时为 0。 */
  downloadCount: number;
}

export interface SkillSearchFilters {
  query?: string;
  namespace?: string;
  keyword?: string;
  visibility?: SkillVisibility;
  limit?: number;
}

export async function executeSearch(
  query: string | undefined,
  options: NetworkCommandOptions = {}
): Promise<SkillSearchResult[]> {
  const fetchImpl = options.customFetch ?? fetch;
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  // 与 info 对齐（ADR-0049 / ADR-0073）：存在有效登录态则随请求携带 Skill
  // User Token；匿名仍可浏览 anonymous 已发布技能，public 需要登录。
  const token = await resolveOptionalFreshToken({ homeDir: options.homeDir });
  const filters = new URLSearchParams();
  if (query !== undefined && query !== '') {
    filters.set('q', query);
  }
  const searchOptions = options as NetworkCommandOptions & SkillSearchFilters;
  // 只有 anonymous 是无登录态可筛的档位；public/private 都明确要求登录，
  // 而不是悄悄返回空结果。
  if (searchOptions.visibility && searchOptions.visibility !== 'anonymous' && !token) {
    throw new Error(
      `Searching ${searchOptions.visibility} skills requires login; run "esl login" first ` +
        '(only anonymous skills are visible without an account)'
    );
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
