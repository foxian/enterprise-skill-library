import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages/login.page';
import { resolveTestEnv } from '../helpers/env';

const env = resolveTestEnv();

test.describe('管理后台登录', () => {
  test('密码错误时停留在登录页并展示错误提示', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: env.superAdmin.username, password: 'definitely-wrong-password' });
    // 登录走 Gitea,冷查询偶发慢,放宽等待
    await expect(loginPage.errorAlert).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('组织管理员登录后进入成员管理页', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: env.orgAdmin.username, password: env.orgAdmin.password, org: env.org });
    await expect(page).toHaveURL(/\/admin\/org\/members$/, { timeout: 15_000 });
  });

  test('平台超管登录后进入平台概览页', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: env.superAdmin.username, password: env.superAdmin.password });
    await expect(page).toHaveURL(/\/admin\/super\/dashboard$/, { timeout: 15_000 });
  });
});
