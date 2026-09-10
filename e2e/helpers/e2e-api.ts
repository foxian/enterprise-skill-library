import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { MEMBER_PASSWORD, resolveTestEnv } from './env';

/** 经组织管理员 API 造成员(异步 Operation),轮询到成员出现在在册列表为止 */
export async function createOrgMember(adminApi: APIRequestContext, shortUsername: string): Promise<string> {
  const env = resolveTestEnv();
  const fullUsername = `${env.org}_${shortUsername}`;
  const created = await adminApi.post('/api/orgs/members', {
    data: { username: shortUsername, password: MEMBER_PASSWORD }
  });
  if (created.status() !== 202) {
    throw new Error(`成员创建失败: ${created.status()} ${await created.text()}`);
  }
  await expect
    .poll(async () => {
      const response = await adminApi.get('/api/orgs/members');
      const members = (await response.json()) as Array<{ username: string }>;
      return members.some((member) => member.username === fullUsername);
    }, { timeout: 30_000 })
    .toBe(true);
  return fullUsername;
}

/** 成员密码登录换取 token 的 APIRequestContext;调用方负责 dispose */
export async function loginMemberApi(
  request: APIRequestContext,
  shortUsername: string
): Promise<APIRequestContext> {
  const env = resolveTestEnv();
  const login = await request.post('/api/console/login', {
    data: { username: shortUsername, org: env.org, password: MEMBER_PASSWORD }
  });
  if (!login.ok()) {
    throw new Error(`成员 API 登录失败: ${login.status()} ${await login.text()}`);
  }
  const { token } = (await login.json()) as { token: string };
  return playwrightRequest.newContext({
    baseURL: env.baseURL,
    extraHTTPHeaders: { Authorization: `token ${token}` }
  });
}

/** Source Upload 创建私有未发布技能(ADR-0025:创建者自动成为初始 Maintainer) */
export async function uploadSkill(
  api: APIRequestContext,
  shortName: string,
  description: string
): Promise<void> {
  const response = await api.post('/api/skills/upload', { data: { name: shortName, description } });
  if (response.status() !== 201) {
    throw new Error(`技能上传失败: ${response.status()} ${await response.text()}`);
  }
}

export interface InventoryItem {
  skillName: string;
  scope: string;
  status?: string;
  access: 'read' | 'write' | 'manage';
  relation: 'managed' | 'shared';
}

/** 平台超管 token 的 APIRequestContext(技能删除等平台级操作用);调用方负责 dispose */
export async function loginSuperApi(request: APIRequestContext): Promise<APIRequestContext> {
  const env = resolveTestEnv();
  const login = await request.post('/api/console/login', {
    data: { username: env.superAdmin.username, org: null, password: env.superAdmin.password }
  });
  if (!login.ok()) {
    throw new Error(`超管 API 登录失败: ${login.status()} ${await login.text()}`);
  }
  const { token } = (await login.json()) as { token: string };
  return playwrightRequest.newContext({
    baseURL: env.baseURL,
    extraHTTPHeaders: { Authorization: `token ${token}` }
  });
}

/** 平台管理员删除技能:用例收尾清理自造数据,抑制 inventory 随运行累积膨胀 */
export async function deleteSkill(api: APIRequestContext, scope: string, shortName: string): Promise<void> {
  const response = await api.post(
    `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(shortName)}/delete`,
    { data: { confirm: `@${scope}/${shortName}` } }
  );
  if (!response.ok()) {
    throw new Error(`技能删除失败: ${response.status()} ${await response.text()}`);
  }
}

export async function inventoryOf(api: APIRequestContext): Promise<InventoryItem[]> {
  const response = await api.get('/api/skills/inventory');
  if (!response.ok()) {
    throw new Error(`inventory 读取失败: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as InventoryItem[];
}
