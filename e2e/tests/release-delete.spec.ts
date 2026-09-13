// spec: CONTEXT.md「单版本删除」/ ADR-0030
// seed: e2e/tests/seed.spec.ts
// 发布能力经 helpers/release-api.ts 造出(Gitea Contents API 等价 git push)。

import { randomUUID } from 'node:crypto';
import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages/login.page';
import { MemberSkillsPage } from '../pages/member-skills.page';
import { MEMBER_PASSWORD, resolveTestEnv } from '../helpers/env';
import {
  createOrgMember,
  deleteSkill,
  loginMemberApi,
  loginSuperApi,
  uploadSkill
} from '../helpers/e2e-api';
import { publishSkillRelease } from '../helpers/release-api';

const env = resolveTestEnv();

async function cleanupSkill(request: APIRequestContext, skillName: string): Promise<void> {
  try {
    const superApi = await loginSuperApi(request);
    await deleteSkill(superApi, env.org, skillName);
    await superApi.dispose();
  } catch {
    // 清理失败不影响用例结论;npm run reset:dev 可全量回收
  }
}

/** 造一个已发布两个 Release 的技能,返回 {skillName, ownerShort, ownerApi} */
async function createReleasedSkill(
  adminApi: APIRequestContext,
  request: APIRequestContext,
  suffix: string,
  notes?: string
) {
  const ownerShort = `e2e-owner-${suffix}`;
  const skillName = `e2e-release-${suffix}`;
  await createOrgMember(adminApi, ownerShort);
  const ownerApi = await loginMemberApi(request, ownerShort);
  await uploadSkill(ownerApi, skillName, '单版本删除 E2E 技能');
  await publishSkillRelease(ownerApi, skillName, '0.1.0', { notes });
  await publishSkillRelease(ownerApi, skillName, '0.2.0', { notes });
  return { skillName, ownerShort, ownerApi };
}

test.describe('单版本删除 (Skill Release Deletion)', () => {
  // 成员创建(异步 Operation)+ 两次发布 + 浏览器登录全串行打 Gitea
  test.setTimeout(180_000);

  test('管理者经发布历史删除单个 Release;确认不符被拒,删除后版本号不可复用', async ({
    adminApi,
    request,
    page
  }) => {
    const suffix = randomUUID().slice(0, 8);
    const { skillName, ownerShort, ownerApi } = await createReleasedSkill(
      adminApi,
      request,
      suffix,
      'E2E 删除用例发布'
    );
    try {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login({ username: ownerShort, password: MEMBER_PASSWORD, org: env.org });
      const skillsPage = new MemberSkillsPage(page);
      await expect(skillsPage.managedRow(skillName)).toBeVisible({ timeout: 60_000 });
      await skillsPage.openPermissions(skillName);
      await expect(page.getByTestId('skill-manage-panel')).toBeVisible();
      await expect(page).toHaveURL(/\/manage$/);

      // 发布历史折叠区默认收起,先展开再断言两个版本都在
      await page.getByText('展开全部 Skill Release').click();
      const historyTable = page.getByTestId('release-history-table');
      await expect(historyTable.getByText('v0.1.0')).toBeVisible();
      await expect(historyTable.getByText('v0.2.0')).toBeVisible();

      const deleteButton = page.getByTestId('delete-release-0.1.0');
      await expect(deleteButton).toBeVisible();

      // 确认输入与版本号不符:拒绝删除,面板给出错误提示
      await deleteButton.click();
      const dialog = page.getByRole('dialog', { name: '删除 Skill Release' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('textbox').fill('9.9.9');
      await dialog.getByRole('button', { name: '删除' }).click();
      await expect(page.getByText('确认失败：请输入完整版本号 0.1.0')).toBeVisible();
      await expect(dialog).toHaveCount(0);

      // 输入完整版本号确认:删除成功,发布历史只剩 0.2.0
      await deleteButton.click();
      const dialogAgain = page.getByRole('dialog', { name: '删除 Skill Release' });
      await expect(dialogAgain).toBeVisible();
      await dialogAgain.getByRole('textbox').fill('0.1.0');
      await dialogAgain.getByRole('button', { name: '删除' }).click();
      await expect(historyTable.getByText('v0.1.0')).toHaveCount(0, { timeout: 30_000 });
      await expect(historyTable.getByText('v0.2.0')).toBeVisible();

      // 版本号已随墓碑作废(CONTEXT:单版本删除):重新发布 0.1.0 必须被拒
      await expect(publishSkillRelease(ownerApi, skillName, '0.1.0')).rejects.toThrow(/409/);
    } finally {
      await ownerApi.dispose();
      await cleanupSkill(request, skillName);
    }
  });

  test('只读查看者的删除入口禁用,悬停提示需要管理权', async ({ adminApi, request, browser }) => {
    const suffix = randomUUID().slice(0, 8);
    const ownerShort = `e2e-owner-${suffix}`;
    const viewerShort = `e2e-viewer-${suffix}`;
    const skillName = `e2e-release-${suffix}`;
    await createOrgMember(adminApi, ownerShort);
    await createOrgMember(adminApi, viewerShort);
    const ownerApi = await loginMemberApi(request, ownerShort);
    await uploadSkill(ownerApi, skillName, '单版本删除门控 E2E 技能');
    await publishSkillRelease(ownerApi, skillName, '0.1.0');
    // 全员只读:viewer 能打开管理面板,但不持管理权
    await ownerApi.post(
      `/api/skills/${encodeURIComponent(env.org)}/${encodeURIComponent(skillName)}/permissions`,
      { data: { action: 'share_all_read' } }
    );
    await ownerApi.dispose();

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    try {
      const loginPage = new LoginPage(viewerPage);
      await loginPage.goto();
      await loginPage.login({ username: viewerShort, password: MEMBER_PASSWORD, org: env.org });
      // 等登录路由落地再整页跳转:过早 goto 会中断登录请求,刷新后没有会话
      await expect(viewerPage).toHaveURL(/member\/skills/, { timeout: 30_000 });
      // 共享技能行没有管理入口,直接走管理页路由
      await viewerPage.goto(`/admin/member/skills/${env.org}/${skillName}/manage`);
      const panel = viewerPage.getByTestId('skill-manage-panel');
      await expect(panel).toBeVisible();
      // 发布历史折叠区默认收起,先展开再断言
      await panel.getByText('展开全部 Skill Release').click();
      const historyTable = panel.getByTestId('release-history-table');
      await expect(historyTable.getByText('v0.1.0')).toBeVisible();

      const deleteButton = viewerPage.getByTestId('delete-release-0.1.0');
      await expect(deleteButton).toBeDisabled();
      await deleteButton.hover();
      await expect(viewerPage.getByText('需要该技能的管理权')).toBeVisible();
    } finally {
      await viewerContext.close();
      await cleanupSkill(request, skillName);
    }
  });
});
