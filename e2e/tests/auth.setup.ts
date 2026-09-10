import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ORG_ADMIN_STATE, SUPER_STATE, resolveTestEnv } from '../helpers/env';

const env = resolveTestEnv();

setup('建立平台超管会话', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login({ username: env.superAdmin.username, password: env.superAdmin.password });
  await expect(page).toHaveURL(/\/admin\/super\/dashboard$/);
  mkdirSync(path.dirname(SUPER_STATE), { recursive: true });
  await page.context().storageState({ path: SUPER_STATE });
});

setup('建立组织管理员会话', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login({ username: env.orgAdmin.username, password: env.orgAdmin.password, org: env.org });
  await expect(page).toHaveURL(/\/admin\/org\/members$/);
  mkdirSync(path.dirname(ORG_ADMIN_STATE), { recursive: true });
  await page.context().storageState({ path: ORG_ADMIN_STATE });
});
