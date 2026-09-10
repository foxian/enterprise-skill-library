import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { resolveTestEnv } from '../helpers/env';

export { expect };

/**
 * 预认证的组织管理员 APIRequestContext:经 /api/console/login 换取 token,
 * 用于造数据/断言后端状态,不驱动 UI。
 */
export const test = base.extend<{ adminApi: APIRequestContext }>({
  adminApi: async ({ playwright, request }, use) => {
    const env = resolveTestEnv();
    const login = await request.post('/api/console/login', {
      data: { username: env.orgAdmin.username, org: env.org || null, password: env.orgAdmin.password }
    });
    if (!login.ok()) {
      throw new Error(`组织管理员 API 登录失败: ${login.status()} ${await login.text()}`);
    }
    const { token } = (await login.json()) as { token: string };
    const context = await playwright.request.newContext({
      baseURL: env.baseURL,
      extraHTTPHeaders: { Authorization: `token ${token}` }
    });
    await use(context);
    await context.dispose();
  }
});
