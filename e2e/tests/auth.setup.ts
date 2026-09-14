import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { SUPER_STATE, resolveTestEnv } from '../helpers/env';

const env = resolveTestEnv();

setup('建立平台超管会话', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login({ username: env.superAdmin.username, password: env.superAdmin.password });
  await expect(page).toHaveURL(/\/admin\/super\/dashboard$/);
  mkdirSync(path.dirname(SUPER_STATE), { recursive: true });
  await page.context().storageState({ path: SUPER_STATE });
});
