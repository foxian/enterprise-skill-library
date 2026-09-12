// spec: specs/teams-and-share-levels.md
// seed: e2e/tests/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { OrgSkillsPage } from '../pages/org-skills.page';
import { resolveTestEnv } from '../helpers/env';
import {
  createOrgMember,
  deleteSkill,
  loginMemberApi,
  loginSuperApi,
  uploadSkill
} from '../helpers/e2e-api';

const env = resolveTestEnv();

interface TeamView {
  id: number;
  name: string;
  permission: string;
}

// 组织共享级别(ADR-0026)四档:不共享 / 全员只读 / 全员读写 / 全员管理,互斥。
const DEFAULT_TEAM_LABELS = ['只读团队', '读写团队', '技能管理团队', '系统管理团队'];

async function cleanupSkill(request: APIRequestContext, skillName: string): Promise<void> {
  try {
    const superApi = await loginSuperApi(request);
    await deleteSkill(superApi, env.org, skillName);
    await superApi.dispose();
  } catch {
    // 清理失败不影响用例结论;npm run reset:dev 可全量回收
  }
}

async function deleteTeamByName(adminApi: APIRequestContext, name: string): Promise<void> {
  const teams = (await (await adminApi.get('/api/orgs/teams')).json()) as TeamView[];
  const team = teams.find((entry) => entry.name === name);
  if (!team) return;
  await adminApi.delete(`/api/orgs/teams/${team.id}`);
}

/** 造一个由成员上传的私有未发布技能,返回技能名(创建者为初始 Maintainer) */
async function createPrivateSkill(
  adminApi: APIRequestContext,
  request: APIRequestContext,
  suffix: string
): Promise<string> {
  const ownerShort = `e2e-owner-${suffix}`;
  const skillName = `e2e-share-${suffix}`;
  await createOrgMember(adminApi, ownerShort);
  const ownerApi = await loginMemberApi(request, ownerShort);
  await uploadSkill(ownerApi, skillName, '组织共享级别 E2E 技能');
  await ownerApi.dispose();
  return skillName;
}

/** 进入指定技能的权限面板(org admin 视角) */
async function openPermissions(page: Page, skillName: string): Promise<void> {
  const skills = new OrgSkillsPage(page);
  await skills.goto();
  await expect(skills.skillRow(skillName)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId(`configure-${skillName}`).click();
  await expect(page.getByTestId('skill-manage-panel')).toBeVisible();
  await expect(page).toHaveURL(/\/manage$/);
}

test.describe('组织共享级别与授权下拉 (Skill Permissions)', () => {
  test('D-01 组织共享级别单选;更高级别取代低级别', async ({ adminApi, request, orgAdminPage }) => {
    test.setTimeout(180_000);
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);
    const skillName = await createPrivateSkill(adminApi, request, suffix);
    try {
      await openPermissions(page, skillName);

      // 初始:私有技能「仅创建者」,单选项当前为「不共享（私有）」
      await expect(page.getByTestId('share-state')).toHaveText('仅创建者');
      const shareLevel = page.getByTestId('share-level');
      await expect(shareLevel.getByRole('radio', { name: '不共享（私有）' })).toBeChecked();

      // 全员只读
      await shareLevel.getByText('全员只读').click();
      await expect(page.getByTestId('share-state')).toHaveText('全员只读', { timeout: 30_000 });

      // 全员读写:更高级别取代低级别,共享状态区只保留一个全员标签
      await shareLevel.getByText('全员读写').click();
      await expect(page.getByTestId('share-state')).toHaveText('全员读写', { timeout: 30_000 });
      const stateCard = page.getByText('当前共享状态').locator('..');
      await expect(stateCard.getByText(/全员/)).toHaveCount(1);

      // 全员管理
      await shareLevel.getByText('全员管理').click();
      await expect(page.getByTestId('share-state')).toHaveText('全员管理', { timeout: 30_000 });
      await expect(stateCard.getByText(/全员/)).toHaveCount(1);

      // 回到不共享:恢复私有
      await shareLevel.getByText('不共享（私有）').click();
      await expect(page.getByTestId('share-state')).toHaveText('仅创建者', { timeout: 30_000 });
    } finally {
      await cleanupSkill(request, skillName);
    }
  });

  test('D-02 团队授权下拉仅列自定义团队', async ({ adminApi, request, orgAdminPage }) => {
    test.setTimeout(180_000);
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);
    const customTeam = `e2e-custom-${suffix}`;
    const skillName = await createPrivateSkill(adminApi, request, suffix);
    await adminApi.post('/api/orgs/teams', { data: { name: customTeam, permission: 'write' } });
    try {
      await openPermissions(page, skillName);

      const teamSelect = page.getByTestId('team-select');
      await expect(teamSelect).toBeVisible();
      await teamSelect.click();

      // 选项含自定义团队,不含四个默认团队与 Owners
      await expect(page.getByRole('option', { name: new RegExp(customTeam) })).toBeVisible();
      for (const label of [...DEFAULT_TEAM_LABELS, 'Owners']) {
        await expect(page.getByRole('option', { name: new RegExp(label) })).toHaveCount(0);
      }
    } finally {
      await deleteTeamByName(adminApi, customTeam);
      await cleanupSkill(request, skillName);
    }
  });

  test('D-03 成员授权下拉排除 admin 与系统管理团队成员', async ({ adminApi, request, orgAdminPage }) => {
    test.setTimeout(180_000);
    const page = orgAdminPage;
    const suffix = randomUUID().slice(0, 8);
    const memberShort = `e2e-member-${suffix}`;
    const saShort = `e2e-sa2-${suffix}`;
    await createOrgMember(adminApi, memberShort);
    await createOrgMember(adminApi, saShort);
    const teams = (await (await adminApi.get('/api/orgs/teams')).json()) as TeamView[];
    const systemAdmins = teams.find((team) => team.name === 'system-admins');
    expect(systemAdmins).toBeDefined();
    await adminApi.post(`/api/orgs/teams/${systemAdmins!.id}/members`, { data: { username: saShort } });

    const skillName = await createPrivateSkill(adminApi, request, suffix);
    try {
      await openPermissions(page, skillName);

      const memberSelect = page.getByTestId('member-select');
      await expect(memberSelect).toBeVisible();
      await memberSelect.click();

      // 普通成员在选项中;admin 账号与系统管理团队成员被排除
      await expect(page.getByRole('option', { name: memberShort })).toBeVisible();
      await expect(page.getByRole('option', { name: 'admin' })).toHaveCount(0);
      await expect(page.getByRole('option', { name: saShort })).toHaveCount(0);
    } finally {
      await cleanupSkill(request, skillName);
    }
  });
});
