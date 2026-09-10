import { readFileSync } from 'node:fs';
import path from 'node:path';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

// e2e/helpers -> e2e -> 仓库根
const repoRoot = path.resolve(__dirname, '..', '..');

export interface GiteaTeam {
  id: number;
  name: string;
  permission: string;
}

/**
 * 直连 Git Backend(Gitea)的管理员 API 上下文。
 * 组织控制台接口 /api/orgs/teams 已过滤三个全员团队(ADR-0026 展示层),
 * 需要断言这些团队真实成员关系时,只能经 Git Backend 这一事实来源读取。
 * Gitea 由 docker-compose 暴露到宿主 3001 端口;admin token 由 bootstrap
 * 写入 secrets 卷(data/secrets/gitea-admin-token)。
 */
export async function giteaAdminApi(): Promise<APIRequestContext> {
  const baseURL = process.env.E2E_GITEA_URL ?? 'http://localhost:3001';
  const tokenPath = path.resolve(repoRoot, 'data', 'secrets', 'gitea-admin-token');
  const token = readFileSync(tokenPath, 'utf8').trim();
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `token ${token}` }
  });
}

/** Gitea 组织的全部团队(含三个全员团队、系统管理团队与 Owners,展示层过滤不适用) */
export async function giteaListOrgTeams(api: APIRequestContext, org: string): Promise<GiteaTeam[]> {
  const response = await api.get(`/api/v1/orgs/${org}/teams`);
  if (!response.ok()) {
    throw new Error(`Gitea 组织团队读取失败: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as GiteaTeam[];
}

/** 团队成员(完整 Gitea 用户名 <org>_<username>) */
export async function giteaListTeamMembers(api: APIRequestContext, teamId: number): Promise<string[]> {
  const response = await api.get(`/api/v1/teams/${teamId}/members`);
  if (!response.ok()) {
    throw new Error(`Gitea 团队成员读取失败: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as Array<{ username: string }>;
  return body.map((member) => member.username);
}
