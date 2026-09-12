// spec: specs/teams-and-share-levels.md
// seed: e2e/tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages/login.page';
import { MEMBER_PASSWORD, resolveTestEnv } from '../helpers/env';
import { createOrgMember } from '../helpers/e2e-api';

const env = resolveTestEnv();

interface TeamView {
  id: number;
  name: string;
  permission: string;
}

async function getSystemAdminsId(adminApi: APIRequestContext): Promise<number> {
  const teams = (await (await adminApi.get('/api/orgs/teams')).json()) as TeamView[];
  const systemAdmins = teams.find((team) => team.name === 'system-admins');
  if (!systemAdmins) throw new Error('system-admins 团队不存在');
  return systemAdmins.id;
}

test.describe('角色路由 (Role-based Routing)', () => {
  test('E-01 系统管理团队成员登录进入组织管理控制台', async ({ adminApi, request, browser }) => {
    test.setTimeout(120_000);
    const short = `e2e-role-admin-${randomUUID().slice(0, 8)}`;
    const full = await createOrgMember(adminApi, short);
    const systemAdminsId = await getSystemAdminsId(adminApi);
    await adminApi.post(`/api/orgs/teams/${systemAdminsId}/members`, { data: { username: short } });
    await expect
      .poll(async () => {
        const members = await adminApi.get(`/api/orgs/teams/${systemAdminsId}/members`);
        const list = (await members.json()) as Array<{ username: string }>;
        return list.some((member) => member.username === full);
      }, { timeout: 30_000 })
      .toBe(true);

    // 服务端判定 role=org-admin(admin 账号 ∪ system-admins 成员),登录落到组织控制台
    const context = await browser.newContext();
    const page = await context.newPage();
    const login = new LoginPage(page);
    await login.goto();
    await login.login({ username: short, password: MEMBER_PASSWORD, org: env.org });
    await expect(page).toHaveURL(/\/admin\/org\/members/, { timeout: 30_000 });
    await expect(page.getByRole('menuitem', { name: '成员管理' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '团队管理' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '技能管理' })).toBeVisible();
    await context.close();
  });

  test('E-02 普通成员登录仍为成员视图', async ({ adminApi, browser }) => {
    test.setTimeout(90_000);
    const short = `e2e-role-member-${randomUUID().slice(0, 8)}`;
    await createOrgMember(adminApi, short);

    const context = await browser.newContext();
    const page = await context.newPage();
    const login = new LoginPage(page);
    await login.goto();
    await login.login({ username: short, password: MEMBER_PASSWORD, org: env.org });
    await expect(page).toHaveURL(/\/admin\/member\/skills/, { timeout: 30_000 });
    // 成员视图无 org 控制台导航项
    await expect(page.getByRole('menuitem', { name: '我管理的技能' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '团队管理' })).toHaveCount(0);

    // 直接访问 org 路由被路由守卫弹回登录页(to.meta.role !== auth.role)
    await page.goto('/admin/org/members');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
    await context.close();
  });
});
