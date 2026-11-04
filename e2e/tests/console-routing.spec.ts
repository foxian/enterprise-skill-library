import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { loginApi, uploadSkill } from '../helpers/e2e-api';
import { SUPER_STATE, resolveTestEnv } from '../helpers/env';

// 控制台视角与组织治理（ADR-0033 / ADR-0035）：平台角色只有超管与普通用户两个，
// 各自的控制台互不越界；组织治理不是第三个视角，而是逐组织的团队身份——治理入口
// 只对所有者成员渲染，其余成员在同一页面看到的是只读视图。

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

test('普通用户登录后落到个人控制台概览', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  // 开发 seed 的普通成员账号（bob 是 acme 的普通成员，不在组织管理团队）
  await login.login({ username: 'bob', password: env.devPassword });

  await expect(page).toHaveURL(/\/admin\/me\/overview$/);
  await expect(page.getByRole('menuitem', { name: '我的组织' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '技能' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '邀请' })).toBeVisible();
});

test('所有者成员在本组织看到治理入口，并可进入组织详情', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  // alice 是开发 seed 中 acme 的所有者成员（Owners）
  await login.login({ username: 'alice', password: env.devPassword });

  await expect(page).toHaveURL(/\/admin\/me\/overview$/);
  await page.getByRole('menuitem', { name: '我的组织' }).click();

  await expect(page).toHaveURL(/\/admin\/me\/orgs$/);
  await expect(page.getByTestId('org-identity-owner')).toBeVisible();
  await page.getByTestId('manage-acme').click();

  await expect(page).toHaveURL(/\/admin\/me\/orgs\/acme\/members$/);
  await expect(page.getByTestId('members-table')).toBeVisible();
  await expect(page.getByTestId('org-identity')).toHaveText('@acme');
});

test('从组织技能页签进入管理页后，面包屑可逐级返回且侧边栏保持定位', async ({ page }) => {
  // 准备一个 acme 命名空间下的技能（alice 是所有者成员，可直接上传）
  const api = await loginApi('alice', env.devPassword);
  const skillName = `nav-${Date.now().toString(36)}`;
  const identity = `@acme/${skillName}`;
  await uploadSkill(api, identity, '面包屑导航用例');
  await api.dispose();

  const login = new LoginPage(page);
  await login.goto();
  await login.login({ username: 'alice', password: env.devPassword });
  await expect(page).toHaveURL(/\/admin\/me\/overview$/);

  await page.goto('/admin/me/orgs/acme/skills');
  await page.getByTestId(`configure-${skillName}`).click();

  await expect(page).toHaveURL(/\/admin\/me\/skills\/acme\/[^/]+\/manage/);
  const url = new URL(page.url());
  expect(url.searchParams.get('from')).toBe('org-skills');
  expect(url.searchParams.get('org')).toBe('acme');

  await expect(page.getByTestId('crumb-my-orgs')).toHaveText('我的组织');
  await expect(page.getByTestId('crumb-org')).toHaveText('@acme');
  await expect(page.getByTestId('crumb-org-skills')).toHaveText('技能');
  await expect(page.getByTestId('crumb-current')).toHaveText(identity);
  // 深层页不再整栏无高亮：URL 落在 /admin/me/skills 子树，父级菜单「技能」保持选中
  await expect(page.getByRole('menuitem', { name: '技能' })).toHaveClass(/is-active/);

  await page.getByTestId('crumb-org-skills').click();
  await expect(page).toHaveURL(/\/admin\/me\/orgs\/acme\/skills$/);

  // 品牌区回工作台首页（不是公开目录）
  await page.getByTestId('console-brand').click();
  await expect(page).toHaveURL(/\/admin\/me\/overview$/);
});

test('组织成员在同一页面只看到只读视图，且直接敲治理 URL 会被退回组织列表', async ({ page }) => {
  const login = new LoginPage(page);
  await login.goto();
  await login.login({ username: 'bob', password: env.devPassword });
  // 先等登录落地再硬导航：login() 只负责填表提交，立刻 goto 会打断在飞的登录
  // 请求，会话写不进 localStorage，下一跳就被守卫当未登录处理。
  await expect(page).toHaveURL(/\/admin\/me\/overview$/);

  await page.goto('/admin/me/orgs');
  // 普通成员：显示身份标签，但没有治理入口
  await expect(page.getByTestId('org-identity-ordinary')).toBeVisible();
  await expect(page.getByTestId('manage-acme')).toHaveCount(0);

  await page.goto('/admin/me/orgs/acme/teams');
  await expect(page).toHaveURL(/\/admin\/me\/orgs$/);
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
