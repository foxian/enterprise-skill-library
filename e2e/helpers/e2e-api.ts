import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { resolveTestEnv } from './env';

// 全局身份（ADR-0032）：注册 → 登录 → 建组织 → 拉人 → 上传发布，全部经真实
// 栈的 API 完成。账号无组织前缀，一条凭据走遍个人空间与所有组织。

export interface RegisteredUser {
  username: string;
  password: string;
}

let sequence = 0;

/** 生成一个平台内唯一的测试用户名（扁平命名池：先到先得） */
export function uniqueUsername(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export function uniqueOrgName(prefix: string): string {
  return uniqueUsername(prefix);
}

export async function registerUser(
  request: APIRequestContext,
  username: string,
  password: string
): Promise<void> {
  const response = await request.post('/api/auth/register', { data: { username, password } });
  if (response.status() !== 201) {
    throw new Error(`注册失败 (${username}): ${response.status()} ${await response.text()}`);
  }
}

/** 以 username + password 换取一个带 Authorization 头的 API 上下文；调用方负责 dispose */
export async function loginApi(username: string, password: string): Promise<APIRequestContext> {
  const env = resolveTestEnv();
  const bootstrap = await playwrightRequest.newContext({ baseURL: env.baseURL });
  try {
    const login = await bootstrap.post('/api/auth/login', { data: { username, password } });
    if (!login.ok()) {
      throw new Error(`登录失败 (${username}): ${login.status()} ${await login.text()}`);
    }
    const { token } = (await login.json()) as { token: string };
    return playwrightRequest.newContext({
      baseURL: env.baseURL,
      extraHTTPHeaders: { Authorization: `token ${token}` }
    });
  } finally {
    await bootstrap.dispose();
  }
}

/** 注册并登录一个全新的全局账号 */
export async function registerAndLogin(
  request: APIRequestContext,
  prefix: string,
  password: string
): Promise<{ api: APIRequestContext; user: RegisteredUser }> {
  const username = uniqueUsername(prefix);
  await registerUser(request, username, password);
  return { api: await loginApi(username, password), user: { username, password } };
}

/** 创建组织（auto 模式即时开通，创建者成为初始 Organization Admin） */
export async function createOrg(api: APIRequestContext, orgName: string): Promise<void> {
  const response = await api.post('/api/orgs', { data: { orgName } });
  if (response.status() !== 201) {
    throw new Error(`创建组织失败 (${orgName}): ${response.status()} ${await response.text()}`);
  }
}

/** 直拉成员入组（direct 拉人方式即时生效，成员自动进入三个常设团队） */
export async function addOrgMember(
  adminApi: APIRequestContext,
  orgName: string,
  username: string
): Promise<void> {
  const response = await adminApi.post(`/api/orgs/${orgName}/members`, { data: { username } });
  if (response.status() !== 201) {
    throw new Error(`拉人失败 (${orgName} ← ${username}): ${response.status()} ${await response.text()}`);
  }
}

export interface UploadedSkill {
  name: string;
  skillId: string;
  cloneUrl: string;
  gitRepoPath: string;
  status?: string;
}

/** 首次 Source Upload：按 release.json 的 name 在对应命名空间建仓库并固定身份 */
export async function uploadSkill(
  api: APIRequestContext,
  identity: string,
  description: string
): Promise<UploadedSkill> {
  const response = await api.post('/api/skills/upload', { data: { name: identity, description } });
  if (response.status() !== 201) {
    throw new Error(`上传失败 (${identity}): ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as UploadedSkill;
}

/** 设置技能可见性（public = 平台全员可搜可装；private 默认） */
export async function setVisibility(
  api: APIRequestContext,
  identity: string,
  visibility: 'public' | 'private'
): Promise<void> {
  const [scope, shortName] = identity.replace(/^@/, '').split('/');
  const response = await api.post(
    `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(shortName)}/visibility`,
    { data: { visibility } }
  );
  if (!response.ok()) {
    throw new Error(`可见性切换失败 (${identity} → ${visibility}): ${response.status()} ${await response.text()}`);
  }
}

export interface SkillView {
  name: string;
  packageUrl?: string;
  releases: Array<{ version: string; packageUrl: string }>;
}

/** 以调用方身份读取技能（含可下载的 Published Skill Package URL） */
export async function getSkill(api: APIRequestContext, identity: string): Promise<SkillView> {
  const [scope, shortName] = identity.replace(/^@/, '').split('/');
  const response = await api.get(
    `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(shortName)}`
  );
  if (!response.ok()) {
    throw new Error(`技能读取失败 (${identity}): ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as SkillView;
}

/**
 * “安装”的服务端等价：下载 Published Skill Package（CLI install 的第一步，
 * 受同一可见性门禁保护）。
 */
export async function downloadPackage(
  api: APIRequestContext,
  identity: string
): Promise<{ status: number; body: { name?: string; version?: string } | null }> {
  const skill = await getSkill(api, identity);
  if (!skill.packageUrl) {
    throw new Error(`技能 ${identity} 没有可下载的发布包`);
  }
  const response = await api.get(skill.packageUrl.replace(resolveTestEnv().baseURL, ''));
  if (!response.ok()) {
    return { status: response.status(), body: { name: identity } };
  }
  return { status: response.status(), body: (await response.json()) as { name?: string; version?: string } };
}
