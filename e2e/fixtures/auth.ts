import { type Browser, type Page } from '@playwright/test';
import { ORG_ADMIN_STATE, SUPER_STATE } from '../helpers/env';
import { test as apiTest, expect } from './api';

export { expect };

// 角色会话来自 setup 项目登录后的 storageState(会话 token 存 localStorage,
// storageState 原生覆盖)。每个角色一个独立 BrowserContext,天然测试隔离。

/** 平台超管(super)的浏览器页面 */
export const test = apiTest.extend<{ superAdminPage: Page; orgAdminPage: Page }>({
  superAdminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: SUPER_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  orgAdminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: ORG_ADMIN_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  }
});

export type { Browser };
