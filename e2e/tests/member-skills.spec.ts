import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages/login.page';
import { MemberSkillsPage } from '../pages/member-skills.page';
import { MEMBER_PASSWORD, resolveTestEnv } from '../helpers/env';
import { createOrgMember } from '../helpers/e2e-api';

const env = resolveTestEnv();

test.describe('成员技能视图', () => {
  test('新建成员登录后进入技能视图且共享列表可用', async ({ adminApi, page }) => {
    // 经 API 造成员数据(异步 Operation),列表出现即代表 Gitea 账号可用
    const shortUsername = `e2e-${randomUUID().slice(0, 8)}`;
    await createOrgMember(adminApi, shortUsername);

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: shortUsername, password: MEMBER_PASSWORD, org: env.org });
    await expect(page).toHaveURL(/\/admin\/member\/skills$/);

    const skillsPage = new MemberSkillsPage(page);
    await expect(skillsPage.managedTable).toBeVisible();
    await skillsPage.openSharedTab();
    await expect(skillsPage.sharedTable).toBeVisible();
  });
});
