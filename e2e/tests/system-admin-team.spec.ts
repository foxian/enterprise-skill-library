// spec: specs/teams-and-share-levels.md
// seed: e2e/tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { createOrgMember } from '../helpers/e2e-api';
import { resolveTestEnv } from '../helpers/env';

const env = resolveTestEnv();
const org = env.org;

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

/** 展开团队行的成员面板并返回该面板表格 */
async function expandTeamMembers(page: Page, table: Locator, label: string, teamName: string): Promise<Locator> {
  await table.getByRole('row').filter({ hasText: label }).getByRole('button', { name: '展开当前行' }).click();
  return page.getByTestId(`team-members-${teamName}`);
}

test.describe('系统管理团队 (System Management Team)', () => {
  test('B-01 system-admins 中 admin 账号不可移除', async ({ adminApi, orgAdminPage }) => {
    test.setTimeout(60_000);
    const page = orgAdminPage;
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();

    const panel = await expandTeamMembers(page, table, '系统管理团队', 'system-admins');
    await expect(panel).toBeVisible();

    // admin 行显示「管理员」徽标(组织唯一 Owner,ADR-0026),不渲染移除按钮
    await expect(panel.getByTestId('owner-admin-badge')).toBeVisible();
    await expect(panel.getByTestId(`team-remove-${org}_admin`)).toHaveCount(0);

    // 后端防护:直接调 DELETE /members/admin 返回 400
    const id = await getSystemAdminsId(adminApi);
    const del = await adminApi.delete(`/api/orgs/teams/${id}/members/admin`);
    expect(del.status()).toBe(400);
    expect((await del.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('cannot be removed from the system admins team')
    });
  });

  test('B-02 可添加/移除普通成员进出 system-admins', async ({ adminApi, orgAdminPage }) => {
    test.setTimeout(120_000);
    const page = orgAdminPage;
    const short = `e2e-sa-${randomUUID().slice(0, 8)}`;
    const full = await createOrgMember(adminApi, short);
    const systemAdminsId = await getSystemAdminsId(adminApi);

    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();
    const panel = await expandTeamMembers(page, table, '系统管理团队', 'system-admins');
    await expect(panel).toBeVisible();

    // 添加普通成员:输入短名提交
    // 注意:提交后 TeamMemberPanel 触发 emit('changed') → 外层 loadTeams,
    // el-table 无 row-key 时按引用重建行 → 展开行折叠,所以先用 API 轮询确认
    // 后端已添加,再重新展开面板去验证 UI
    await page.getByTestId('team-add-username').fill(short);
    await page.getByTestId('team-add-submit').click();
    await expect
      .poll(async () => {
        const members = await adminApi.get(`/api/orgs/teams/${systemAdminsId}/members`);
        const list = (await members.json()) as Array<{ username: string }>;
        return list.some((member) => member.username === full);
      }, { timeout: 30_000 })
      .toBe(true);

    // 等待外层 loadTeams 的 loading 遮罩消失后重新展开面板
    await expect(table.locator('.el-loading-mask')).toHaveCount(0, { timeout: 15_000 });
    const memberPanel = await expandTeamMembers(page, table, '系统管理团队', 'system-admins');
    await expect(memberPanel.getByRole('row').filter({ hasText: short })).toBeVisible({ timeout: 15_000 });

    // 移除:点击完整用户名对应的移除按钮,再用 API 轮询确认已移除
    await page.getByTestId(`team-remove-${full}`).click();
    await expect
      .poll(async () => {
        const members = await adminApi.get(`/api/orgs/teams/${systemAdminsId}/members`);
        const list = (await members.json()) as Array<{ username: string }>;
        return !list.some((member) => member.username === full);
      }, { timeout: 30_000 })
      .toBe(true);

    // 同样:移除也触发 loadTeams → 面板折叠,重新展开后验证 UI
    await expect(table.locator('.el-loading-mask')).toHaveCount(0, { timeout: 15_000 });
    const rePanel = await expandTeamMembers(page, table, '系统管理团队', 'system-admins');
    await expect(rePanel.getByRole('row').filter({ hasText: short })).toHaveCount(0, { timeout: 15_000 });
  });
});
