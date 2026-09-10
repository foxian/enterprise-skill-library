// spec: specs/teams-and-share-levels.md
// seed: e2e/tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { createOrgMember } from '../helpers/e2e-api';
import { resolveTestEnv } from '../helpers/env';
import { giteaAdminApi, giteaListOrgTeams, giteaListTeamMembers } from '../helpers/gitea-api';

// ADR-0026 三个全员默认团队:成员创建/启用自动加入;system-admins 是手动
// 管理的委托团队,不自动加入(禁用清出后启用也不恢复)。
// 三个全员团队不展示于团队管理页(服务端 /api/orgs/teams 已过滤),其成员
// 关系经 Git Backend(Gitea)这一事实来源断言。
const ALL_MEMBER_TEAM_NAMES = ['all-readers', 'all-writers', 'all-managers'] as const;

/** 读取三个全员团队与系统管理团队的 Gitea 团队 ID */
async function getTeamIds(org: string): Promise<{ allMember: Record<string, number>; systemAdmins: number }> {
  const giteaApi = await giteaAdminApi();
  try {
    const teams = await giteaListOrgTeams(giteaApi, org);
    const allMember: Record<string, number> = {};
    for (const name of ALL_MEMBER_TEAM_NAMES) {
      const team = teams.find((entry) => entry.name === name);
      if (!team) throw new Error(`${name} 团队不存在`);
      allMember[name] = team.id;
    }
    const systemAdmins = teams.find((entry) => entry.name === 'system-admins');
    if (!systemAdmins) throw new Error('system-admins 团队不存在');
    return { allMember, systemAdmins: systemAdmins.id };
  } finally {
    await giteaApi.dispose();
  }
}

/** 断言完整用户名出现在 Gitea 团队(异步 Operation,poll 至终态) */
async function expectMemberInTeam(org: string, teamId: number, full: string): Promise<void> {
  const giteaApi = await giteaAdminApi();
  try {
    await expect
      .poll(async () => {
        const members = await giteaListTeamMembers(giteaApi, teamId);
        return members.includes(full);
      }, { timeout: 30_000 })
      .toBe(true);
  } finally {
    await giteaApi.dispose();
  }
}

/** 断言完整用户名不在 Gitea 团队(异步 Operation,poll 至终态) */
async function expectMemberNotInTeam(org: string, teamId: number, full: string): Promise<void> {
  const giteaApi = await giteaAdminApi();
  try {
    await expect
      .poll(async () => {
        const members = await giteaListTeamMembers(giteaApi, teamId);
        return !members.includes(full);
      }, { timeout: 30_000 })
      .toBe(true);
  } finally {
    await giteaApi.dispose();
  }
}

/** 在成员管理页禁用并等待进入已禁用列表 */
async function disableMember(page: Page, adminApi: APIRequestContext, full: string): Promise<void> {
  await page.goto('/admin/org/members');
  await page.getByTestId(`disable-${full}`).click();
  await page.getByTestId('disable-member-confirm').click();
  await expect
    .poll(async () => {
      const disabled = await adminApi.get('/api/orgs/members/disabled');
      const list = (await disabled.json()) as Array<{ username: string }>;
      return list.some((member) => member.username === full);
    }, { timeout: 30_000 })
    .toBe(true);
}

test.describe('成员生命周期 (Member Lifecycle)', () => {
  test('C-01 新建成员自动加入三个全员团队', async ({ adminApi }) => {
    test.setTimeout(120_000);
    const env = resolveTestEnv();
    const short = `e2e-life-${randomUUID().slice(0, 8)}`;
    const full = await createOrgMember(adminApi, short);
    const { allMember, systemAdmins } = await getTeamIds(env.org);

    // 新成员自动加入三个全员团队
    for (const teamId of Object.values(allMember)) {
      await expectMemberInTeam(env.org, teamId, full);
    }
    // system-admins 不自动加入
    await expectMemberNotInTeam(env.org, systemAdmins, full);
  });

  test('C-02 禁用成员后从全部团队移除', async ({ adminApi, orgAdminPage }) => {
    test.setTimeout(120_000);
    const page = orgAdminPage;
    const env = resolveTestEnv();
    const short = `e2e-life-${randomUUID().slice(0, 8)}`;
    const full = await createOrgMember(adminApi, short);
    const { allMember, systemAdmins } = await getTeamIds(env.org);

    // 先确认已加入三个全员团队
    for (const teamId of Object.values(allMember)) {
      await expectMemberInTeam(env.org, teamId, full);
    }

    // 禁用:成员从全部团队移除
    await disableMember(page, adminApi, full);
    for (const teamId of Object.values(allMember)) {
      await expectMemberNotInTeam(env.org, teamId, full);
    }
    await expectMemberNotInTeam(env.org, systemAdmins, full);
  });

  test('C-03 重新启用只回三个全员团队、不回系统管理团队', async ({ adminApi, orgAdminPage }) => {
    test.setTimeout(150_000);
    const page = orgAdminPage;
    const env = resolveTestEnv();
    const short = `e2e-life2-${randomUUID().slice(0, 8)}`;
    const full = await createOrgMember(adminApi, short);
    const { allMember, systemAdmins } = await getTeamIds(env.org);

    // 把成员加入 system-admins(委托团队,手动管理)
    await adminApi.post(`/api/orgs/teams/${systemAdmins}/members`, { data: { username: short } });
    await expectMemberInTeam(env.org, systemAdmins, full);

    // 禁用:等待后端确认进入已禁用列表
    await disableMember(page, adminApi, full);

    // 启用:切到已禁用 tab 点击目标成员的启用按钮
    await page.getByRole('tab', { name: /已禁用/ }).click();
    await expect(
      page.getByTestId('disabled-members-table').getByRole('row').filter({ hasText: short })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`enable-${full}`).click();
    // 等待成员回到在册列表(异步 Operation)
    await expect
      .poll(async () => {
        const members = await adminApi.get('/api/orgs/members');
        const list = (await members.json()) as Array<{ username: string }>;
        return list.some((member) => member.username === full);
      }, { timeout: 30_000 })
      .toBe(true);

    // 回到三个全员团队
    for (const teamId of Object.values(allMember)) {
      await expectMemberInTeam(env.org, teamId, full);
    }
    // 敏感授权不自动恢复:不回 system-admins
    await expectMemberNotInTeam(env.org, systemAdmins, full);
  });
});
