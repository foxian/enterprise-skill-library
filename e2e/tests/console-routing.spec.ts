import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { SUPER_STATE, resolveTestEnv } from '../helpers/env';

// 角色视角路由（ADR-0032 / #60）：登录只有用户名 + 密码；超管进超管控制台，
// 普通成员进个人中心。组织管理员的落点由其在 Gitea Owners 团队中的成员身份派生。

const env = resolveTestEnv();

test('超管登录后落到超管控制台，且控制台提供注册审批与平台设置入口', async ({ page }) => {
  await page.context().addCookies([]);
  await page.goto('/admin/login');
  const login = new LoginPage(page);
  await login.login({ username: env.superAdmin.username, password: env.superAdmin.password });

  await expect(page).toHaveURL(/\/admin\/super\/dashboard$/);
  await expect(page.getByText('用户注册审批')).toBeVisible();
  await expect(page.getByText('平台设置')).toBeVisible();
});

test('普通成员登录后落到个人中心（跨命名空间聚合视图）', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  // 开发 seed 的普通成员账号（bob 是 acme 的普通成员，不在 Owners 团队）
  await login.login({ username: 'bob', password: env.devPassword });

  await expect(page).toHaveURL(/\/admin\/member\/skills$/);
  await expect(page.getByTestId('namespace-filter')).toBeVisible();
});

test('组织管理员（Owners 成员）登录后落到组织控制台', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  // alice 是开发 seed 中 acme 的组织管理员（Owners 团队成员）
  await login.login({ username: 'alice', password: env.devPassword });

  await expect(page).toHaveURL(/\/admin\/org\/members$/);
  await expect(page.getByTestId('members-table')).toBeVisible();
});

test('未登录访问控制台被带回登录页', async ({ page }) => {
  await page.goto('/admin/super/settings');
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test('超管会话存储可复用（storageState 直接进超管控制台）', async ({ browser }) => {
  const context = await browser.newContext({ storageState: SUPER_STATE });
  const page = await context.newPage();
  await page.goto('/admin/super/settings');
  await expect(page.getByTestId('save-settings')).toBeVisible();
  await context.close();
});
