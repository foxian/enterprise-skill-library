import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { resolveTestEnv } from '../helpers/env';

export { expect };

/**
 * 预认证的超管 APIRequestContext:经 /api/console/login 换取 token,
 * 用于造数据/断言后端状态,不驱动 UI(ADR-0032 超管结构不变)。
 */
export const test = base.extend<{ adminApi: APIRequestContext }>({
  adminApi: async ({ playwright, request }, use) => {
    const env = resolveTestEnv();
    const login = await request.post('/api/console/login', {
      data: { username: env.superAdmin.username, password: env.superAdmin.password }
    });
    if (!login.ok()) {
      throw new Error(`超管 API 登录失败: ${login.status()} ${await login.text()}`);
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
