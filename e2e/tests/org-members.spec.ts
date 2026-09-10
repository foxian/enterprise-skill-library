import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/auth';
import { MembersPage } from '../pages/members.page';
import { MEMBER_PASSWORD, resolveTestEnv } from '../helpers/env';

const env = resolveTestEnv();

test.describe('组织成员管理', () => {
  test('在册成员列表展示管理员徽标且管理员不可禁用', async ({ orgAdminPage }) => {
    const membersPage = new MembersPage(orgAdminPage);
    await membersPage.goto();
    await expect(membersPage.table).toBeVisible();

    const adminFullName = `${env.org}_admin`;
    // 成员列表经 Gitea 异步加载,放宽等待
    await expect(membersPage.resetPasswordButton(adminFullName)).toBeVisible({ timeout: 15_000 });
    await expect(orgAdminPage.getByTestId('admin-badge')).toBeVisible();
    await expect(membersPage.disableButton(adminFullName)).toHaveCount(0);
  });

  test('添加成员后成员出现在在册列表', async ({ orgAdminPage }) => {
    const membersPage = new MembersPage(orgAdminPage);
    const shortUsername = `e2e-${randomUUID().slice(0, 8)}`;
    await membersPage.goto();
    await membersPage.addMember(shortUsername, MEMBER_PASSWORD);
    // 成员创建是异步 Operation,完成后前端才刷新列表,放宽断言超时等待
    await expect(membersPage.memberRow(shortUsername)).toBeVisible({ timeout: 15_000 });
  });
});
