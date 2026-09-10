import { randomUUID } from 'node:crypto';
import { type APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { LoginPage } from '../pages/login.page';
import { MemberSkillsPage } from '../pages/member-skills.page';
import { OrgSkillsPage } from '../pages/org-skills.page';
import { SuperSkillsPage } from '../pages/super-skills.page';
import { MEMBER_PASSWORD, resolveTestEnv } from '../helpers/env';
import {
  createOrgMember,
  deleteSkill,
  inventoryOf,
  loginMemberApi,
  loginSuperApi,
  uploadSkill
} from '../helpers/e2e-api';

const env = resolveTestEnv();

// ADR-0025:三档权限(Read/Write/Manage)、管理权可授予、角色化技能可见性
// (超管跨组织、组织管理员本组织、成员"我管理的/共享给我的",均含未发布)。
// 每个用例经 API 自造成员与私有未发布技能,互不依赖执行顺序;收尾 best-effort
// 删除自造技能,抑制 inventory 的每技能 Gitea 授权判定随运行累积膨胀。
// inventory 对每个技能都 round-trip Gitea,数据多时 legitimately 慢,相关
// "列表出现"断言放宽到 60s(只在失败时付出等待代价,不引入固定 sleep)。

async function cleanupSkill(request: APIRequestContext, skillName: string): Promise<void> {
  try {
    const superApi = await loginSuperApi(request);
    await deleteSkill(superApi, env.org, skillName);
    await superApi.dispose();
  } catch {
    // 清理失败不影响用例结论;重置开发栈(npm run reset:dev)可全量回收
  }
}

test.describe('ADR-0025 管理权档位与角色化技能可见性', () => {
  // 造数据(成员 Operation + 技能上传)与多角色登录全串行打 Gitea,单链路远超默认 30s
  test.setTimeout(120_000);

  test('成员上传的私有未发布技能进入"我管理的",未授权成员不可见', async ({ adminApi, request, page }) => {
    const suffix = randomUUID().slice(0, 8);
    const ownerShort = `e2e-owner-${suffix}`;
    const strangerShort = `e2e-stranger-${suffix}`;
    const skillName = `e2e-skill-${suffix}`;
    await createOrgMember(adminApi, ownerShort);
    await createOrgMember(adminApi, strangerShort);
    const ownerApi = await loginMemberApi(request, ownerShort);
    await uploadSkill(ownerApi, skillName, 'ADR-0025 可见性 E2E 技能');

    // 未授权成员的 inventory 不含该技能(服务端按读权限过滤)
    const strangerApi = await loginMemberApi(request, strangerShort);
    const strangerItems = await inventoryOf(strangerApi);
    expect(strangerItems.some((item) => item.skillName === skillName)).toBe(false);
    await strangerApi.dispose();
    await ownerApi.dispose();

    // 创建者(初始 Maintainer)登录后技能出现在"我管理的",共享状态为私有
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: ownerShort, password: MEMBER_PASSWORD, org: env.org });
    await expect(page).toHaveURL(/\/admin\/member\/skills$/, { timeout: 15_000 });
    const skillsPage = new MemberSkillsPage(page);
    await expect(skillsPage.managedRow(skillName)).toBeVisible({ timeout: 60_000 });
    await expect(skillsPage.managedTable).toBeVisible();
    await expect(page.getByTestId(`skill-state-${skillName}`)).toHaveText('仅创建者');

    await cleanupSkill(request, skillName);
  });

  test('权限面板授予"管理"档后,被授权成员升级为技能管理者', async ({ adminApi, request, page, browser }) => {
    const suffix = randomUUID().slice(0, 8);
    const ownerShort = `e2e-owner-${suffix}`;
    const guestShort = `e2e-guest-${suffix}`;
    const skillName = `e2e-skill-${suffix}`;
    await createOrgMember(adminApi, ownerShort);
    await createOrgMember(adminApi, guestShort);
    const ownerApi = await loginMemberApi(request, ownerShort);
    await uploadSkill(ownerApi, skillName, 'ADR-0025 管理权授予 E2E 技能');
    await ownerApi.dispose();

    // 持有管理权者经权限面板授予 guest「管理」档(manage)
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login({ username: ownerShort, password: MEMBER_PASSWORD, org: env.org });
    const skillsPage = new MemberSkillsPage(page);
    await expect(skillsPage.managedRow(skillName)).toBeVisible({ timeout: 60_000 });
    await skillsPage.openPermissions(skillName);
    await expect(page.getByTestId('skill-permissions-panel')).toBeVisible();
    // 成员视角面板无成员下拉建议,退化为手工输入(需完整 Gitea 用户名)
    await page.getByTestId('member-input').fill(`${env.org}_${guestShort}`);
    await page.getByTestId('member-permission').click();
    await page.getByRole('option', { name: '管理' }).click();
    await page.getByTestId('grant-member').click();
    // 授权经 Operation 同步完成后返回新矩阵;面板已有创建者标签,按文本过滤定位 guest 的三档「管理」
    await expect(page.getByTestId('granted-member').filter({ hasText: guestShort })).toHaveText(
      `${guestShort}（管理）`,
      { timeout: 30_000 }
    );

    // guest 的 inventory 出现该技能且 relation=managed(manage 归"我管理的"而非"共享给我的")
    const guestApi = await loginMemberApi(request, guestShort);
    const guestItems = await inventoryOf(guestApi);
    const granted = guestItems.find((item) => item.skillName === skillName);
    expect(granted?.relation).toBe('managed');
    expect(granted?.access).toBe('manage');
    await guestApi.dispose();

    // guest UI:登录后"我管理的"出现该技能,"共享给我的"不出现
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    const guestLogin = new LoginPage(guestPage);
    await guestLogin.goto();
    await guestLogin.login({ username: guestShort, password: MEMBER_PASSWORD, org: env.org });
    const guestSkills = new MemberSkillsPage(guestPage);
    await expect(guestSkills.managedRow(skillName)).toBeVisible({ timeout: 60_000 });
    await guestSkills.openSharedTab();
    await expect(guestSkills.sharedRow(skillName)).toHaveCount(0);
    await guestContext.close();

    await cleanupSkill(request, skillName);
  });

  test('组织管理员技能页可见本组织未发布技能', async ({ adminApi, request, orgAdminPage }) => {
    const suffix = randomUUID().slice(0, 8);
    const ownerShort = `e2e-owner-${suffix}`;
    const skillName = `e2e-skill-${suffix}`;
    await createOrgMember(adminApi, ownerShort);
    const ownerApi = await loginMemberApi(request, ownerShort);
    await uploadSkill(ownerApi, skillName, 'ADR-0025 组织视图 E2E 技能');
    await ownerApi.dispose();

    const orgSkills = new OrgSkillsPage(orgAdminPage);
    await orgSkills.goto();
    await expect(orgSkills.skillRow(skillName)).toBeVisible({ timeout: 60_000 });
    // 组织管理员持有矩阵读取权,共享状态呈现真实状态(私有)
    await expect(orgSkills.skillStateTag(skillName)).toHaveText('仅创建者');

    await cleanupSkill(request, skillName);
  });

  test('超管技能总览跨组织可见', async ({ adminApi, request, superAdminPage }) => {
    const suffix = randomUUID().slice(0, 8);
    const ownerShort = `e2e-owner-${suffix}`;
    const skillName = `e2e-skill-${suffix}`;
    await createOrgMember(adminApi, ownerShort);
    const ownerApi = await loginMemberApi(request, ownerShort);
    await uploadSkill(ownerApi, skillName, 'ADR-0025 超管总览 E2E 技能');
    await ownerApi.dispose();

    const superSkills = new SuperSkillsPage(superAdminPage);
    await superSkills.goto();
    await expect(superSkills.skillRow(skillName)).toBeVisible({ timeout: 60_000 });

    await cleanupSkill(request, skillName);
  });
});
