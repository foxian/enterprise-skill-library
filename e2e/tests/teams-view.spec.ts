// spec: specs/teams-and-share-levels.md
// seed: e2e/tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';

interface TeamView {
  id: number;
  name: string;
  permission: string;
}

// ADR-0026 默认团队:三个全员团队(只读/读写/技能管理)不展示于团队管理界面,
// 由组织共享级别承载;系统管理团队是唯一可增删成员的默认团队,保留展示。
const INVALID_NAME_ERROR = 'Team name must use lowercase letters, digits, and hyphens';

/** 收尾 best-effort 清理:按团队名删除自造自定义团队 */
async function deleteTeamByName(api: APIRequestContext, name: string): Promise<void> {
  const teams = (await (await api.get('/api/orgs/teams')).json()) as TeamView[];
  const team = teams.find((entry) => entry.name === name);
  if (!team) return;
  await api.delete(`/api/orgs/teams/${team.id}`);
}

/** 打开新建团队对话框并提交一个自定义团队(UI 全流程) */
async function createTeam(page: Page, name: string, permission: '只读' | '读写' | '管理'): Promise<void> {
  await page.getByTestId('open-create-team').click();
  await page.getByTestId('new-team-name').fill(name);
  await page.getByTestId('new-team-permission').locator(`text=${permission}`).click();
  await page.getByTestId('create-team-submit').click();
}

test.describe('团队管理页 (TeamsView)', () => {
  test('A-01 三个全员团队与 Owners 不显示，仅系统管理团队保留默认标签', async ({ orgAdminPage }) => {
    // 1. 以组织管理员登录，导航到 /admin/org/teams
    const page = orgAdminPage;
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();

    // 2. 系统管理团队是唯一可见的默认团队:中文标签、管理档位、默认团队标签
    const systemRow = table.getByRole('row').filter({ hasText: '系统管理团队' });
    await expect(systemRow).toBeVisible({ timeout: 15_000 });
    await expect(systemRow).toContainText('系统管理团队');
    await expect(systemRow).toContainText('管理');
    await expect(systemRow.getByTestId('default-team-tag')).toBeVisible();
    await expect(page.getByTestId('default-team-tag')).toHaveCount(1);

    // 3. 三个全员团队不展示（服务端 /api/orgs/teams 已过滤;组织共享级别承载它们）
    for (const label of ['只读团队', '读写团队', '技能管理团队']) {
      await expect(table.getByRole('row').filter({ hasText: label })).toHaveCount(0);
    }

    // 4. 断言列表不含 Owners 团队
    await expect(table.getByRole('row').filter({ hasText: 'Owners' })).toHaveCount(0);
  });

  test('A-02 默认团队不可删除、不可编辑（按钮禁用 + 后端拒绝）', async ({ adminApi, orgAdminPage }) => {
    // 1. 导航到 /admin/org/teams，等待 teams-table 可见
    const page = orgAdminPage;
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();

    // 2. 团队管理页可见的默认团队只有系统管理团队:edit/delete 按钮均 disabled
    await expect(page.getByTestId('edit-team-system-admins')).toBeDisabled();
    await expect(page.getByTestId('delete-team-system-admins')).toBeDisabled();

    // 3. 后端防护：PATCH 默认团队传新名返回 400
    const teams = (await (await adminApi.get('/api/orgs/teams')).json()) as TeamView[];
    const systemAdmins = teams.find((team) => team.name === 'system-admins');
    expect(systemAdmins).toBeDefined();
    const patch = await adminApi.patch(`/api/orgs/teams/${systemAdmins!.id}`, { data: { name: 'should-not-work' } });
    expect(patch.status()).toBe(400);
    expect((await patch.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('System teams cannot be edited')
    });

    // 4. 后端防护：DELETE 默认团队返回 400
    const del = await adminApi.delete(`/api/orgs/teams/${systemAdmins!.id}`);
    expect(del.status()).toBe(400);
    expect((await del.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('System teams cannot be deleted')
    });
  });

  test('A-03 自定义团队可创建（read/write/manage 三档）', async ({ adminApi, orgAdminPage }) => {
    test.setTimeout(60_000);
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);

    // 1. 导航到 /admin/org/teams，记录当前团队计数
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();
    // 等默认团队行(system-admins)渲染完成后再读计数，避免 loading 阶段读到 0
    await expect(table.getByRole('row').filter({ hasText: '系统管理团队' })).toBeVisible();
    const initialCount = await table.locator('tbody tr').count();

    const cases = [
      { name: `e2e-team-read-${suffix}`, permission: '只读' },
      { name: `e2e-team-write-${suffix}`, permission: '读写' },
      { name: `e2e-team-manage-${suffix}`, permission: '管理' }
    ] as const;
    const created: string[] = [];
    try {
      // 2/3. 三档各创建一次，断言行出现、类型标签为「自定义」、权限列正确
      for (const c of cases) {
        await createTeam(page, c.name, c.permission);
        const row = table.getByRole('row').filter({ hasText: c.name });
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row).toContainText(c.name);
        await expect(row).toContainText(c.permission);
        await expect(row.getByText('自定义')).toBeVisible();
        created.push(c.name);
      }

      // 4. 断言计数至少 +3。刻意不用绝对相等：组织是共享的，且 fullyParallel 下
      //    其它 spec（如 share-levels D-02 会建团队）会在同一窗口增删团队。
      await expect
        .poll(async () => table.locator('tbody tr').count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(initialCount + 3);
      for (const c of cases) {
        await expect(table.getByRole('row').filter({ hasText: c.name })).toBeVisible();
      }
    } finally {
      // 5. 清理自造自定义团队，恢复 fresh state
      for (const name of created) {
        await deleteTeamByName(adminApi, name);
      }
    }
  });

  test('A-04 自定义团队可编辑标识名与显示名且权限保留', async ({ adminApi, orgAdminPage }) => {
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);
    const oldName = `e2e-team-edit-${suffix}`;
    const newName = `e2e-team-edited-${suffix}`;

    // 1. 创建自定义团队（权限=读写）
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();
    await createTeam(page, oldName, '读写');
    await expect(table.getByRole('row').filter({ hasText: oldName })).toBeVisible({ timeout: 15_000 });

    try {
      // 2. 点击编辑，同时改标识名与显示名（权限不动，因此不触发权限变更的二次确认），
      //    保存后断言成功提示「团队已更新」
      await page.getByTestId(`edit-team-${oldName}`).click();
      await page.getByTestId('edit-team-name').fill(newName);
      await page.getByTestId('edit-team-display-name').fill('编辑后的团队');
      await page.getByTestId('edit-team-confirm').click();
      await expect(page.getByText('团队已更新')).toBeVisible({ timeout: 10_000 });

      // 3. 断言新显示名与标识名出现、旧标识名消失
      const editedRow = table.getByRole('row').filter({ hasText: newName });
      await expect(editedRow).toBeVisible({ timeout: 15_000 });
      await expect(editedRow).toContainText('编辑后的团队');
      await expect(table.getByRole('row').filter({ hasText: oldName })).toHaveCount(0);

      // 4. 断言权限档位与类型保持不变（标识名变更按团队 ID 引用，不断授权）
      await expect(editedRow).toContainText('读写');
      await expect(editedRow.getByText('自定义')).toBeVisible();
    } finally {
      // 5. 清理删除该自定义团队
      await deleteTeamByName(adminApi, newName);
    }
  });

  test('A-05 自定义团队可删除', async ({ adminApi, orgAdminPage }) => {
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);
    const name = `e2e-team-del-${suffix}`;

    // 1. 创建自定义团队
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();
    await createTeam(page, name, '只读');
    await expect(table.getByRole('row').filter({ hasText: name })).toBeVisible({ timeout: 15_000 });

    try {
      // 2. 点击删除，出现确认对话框且文案含团队名
      await page.getByTestId(`delete-team-${name}`).click();
      await expect(page.getByRole('dialog', { name: '删除团队' })).toContainText(name);

      // 3. 确认删除：成功提示「团队已删除」，列表不再包含该团队
      await page.getByTestId('delete-team-confirm').click();
      await expect(page.getByText(`团队 ${name} 已删除`)).toBeVisible({ timeout: 10_000 });
      await expect(table.getByRole('row').filter({ hasText: name })).toHaveCount(0);
    } finally {
      await deleteTeamByName(adminApi, name);
    }
  });

  test('A-06 自定义团队非法名被拒', async ({ adminApi, orgAdminPage }) => {
    const page = orgAdminPage;
    const pageError = page.locator('.page-error');

    // 1. 导航到 /admin/org/teams，打开新建团队对话框，输入含大写/下划线的非法名（Bad_Team）并提交
    await page.goto('/admin/org/teams');
    const table = page.getByTestId('teams-table');
    await expect(table).toBeVisible();
    await page.getByTestId('open-create-team').click();
    await page.getByTestId('new-team-name').fill('Bad_Team');
    await page.getByTestId('new-team-permission').locator('text=只读').click();
    await page.getByTestId('create-team-submit').click();

    // 页面显示错误，团队未创建，对话框保持打开
    await expect(pageError).toContainText(INVALID_NAME_ERROR);
    await expect(table.getByRole('row').filter({ hasText: 'Bad_Team' })).toHaveCount(0);

    // 2. 对超长名（65 个 a）重复创建，同样被拒
    const longName = 'a'.repeat(65);
    await page.getByTestId('new-team-name').fill(longName);
    await page.getByTestId('create-team-submit').click();
    await expect(pageError).toContainText(INVALID_NAME_ERROR);
    await expect(table.getByRole('row').filter({ hasText: longName })).toHaveCount(0);

    // 3. 后端防护：POST 非法名返回 400
    const bad = await adminApi.post('/api/orgs/teams', { data: { name: 'Bad_Team', permission: 'read' } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(INVALID_NAME_ERROR)
    });
    const long = await adminApi.post('/api/orgs/teams', { data: { name: longName, permission: 'read' } });
    expect(long.status()).toBe(400);
    expect((await long.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(INVALID_NAME_ERROR)
    });
  });
});
