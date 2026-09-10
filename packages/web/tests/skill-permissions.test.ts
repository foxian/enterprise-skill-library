import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SkillPermissionsPanel from '../src/components/SkillPermissionsPanel.vue';
import OrgSkillsView from '../src/views/org/SkillsView.vue';
import MemberSkillsView from '../src/views/member/SkillsView.vue';
import OrgSkillPermissionsView from '../src/views/org/SkillPermissionsView.vue';
import SuperSkillsView from '../src/views/super/SkillsView.vue';
import { deriveShareState } from '../src/skills/skill-list';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

const skills = [
  {
    name: '@acme/reviewer',
    scope: 'acme',
    skillName: 'reviewer',
    createdBy: 'acme_alice',
    owner: 'acme_alice'
  },
  {
    name: '@acme/secret',
    scope: 'acme',
    skillName: 'secret',
    createdBy: 'acme_zed',
    owner: 'acme_zed'
  },
  {
    name: '@other/tool',
    scope: 'other',
    skillName: 'tool',
    createdBy: 'other_ada',
    owner: 'other_ada'
  }
];

function matrixFor(skillName: string, overrides: Record<string, unknown> = {}) {
  const owner = skills.find((skill) => skill.skillName === skillName)?.owner ?? '';
  return {
    scope: 'acme',
    skillName,
    sharedAllRead: false,
    sharedAllWrite: false,
    teams: [],
    members: [{ username: owner, permission: 'write' }],
    ...overrides
  };
}

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

describe('技能列表视图', () => {
  it('组织管理员可见全组织技能（含未发布）及共享状态', async () => {
    useApiMock((method, url) => {
      if (url === '/api/skills/inventory') {
        return {
          status: 200,
          json: [
            { ...skills[0], status: 'active-published', access: 'manage', relation: 'managed' },
            { ...skills[1], status: 'active-unreleased', access: 'manage', relation: 'managed' }
          ]
        };
      }
      if (url === '/api/skills/acme/reviewer/permissions') {
        return { status: 200, json: matrixFor('reviewer', { sharedAllRead: true }) };
      }
      if (url === '/api/skills/acme/secret/permissions') {
        return { status: 200, json: matrixFor('secret') };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgSkillsView, { role: 'org-admin', route: '/admin/org/skills' });
    await flushPromises();

    const table = wrapper.find('[data-test="org-skills-table"]').text();
    expect(table).toContain('@acme/reviewer');
    expect(table).toContain('@acme/secret');
    expect(table).toContain('未发布');
    expect(wrapper.find('[data-test="skill-state-reviewer"]').text()).toBe('全员只读');
    expect(wrapper.find('[data-test="skill-state-secret"]').text()).toBe('仅创建者');
  });

  it('成员按「我管理的/共享给我的」双视图查看技能', async () => {
    // member 角色默认账号是 acme 组织的 bob
    useApiMock((_method, url) => {
      if (url === '/api/skills/inventory') {
        return {
          status: 200,
          json: [
            // bob 自己创建（未发布）的技能 → 我管理的
            { ...skills[0], createdBy: 'acme_bob', owner: 'acme_bob', status: 'active-unreleased', access: 'manage', relation: 'managed' },
            // 他人创建、共享给 bob 只读的技能 → 共享给我的
            { ...skills[1], status: 'active-published', access: 'read', relation: 'shared' }
          ]
        };
      }
      if (url === '/api/skills/acme/reviewer/permissions') {
        return { status: 200, json: matrixFor('reviewer', { members: [{ username: 'acme_bob', permission: 'write' }] }) };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MemberSkillsView, { role: 'member', route: '/admin/member/skills' });
    await flushPromises();

    // 「我管理的」Tab：只显示自己持有管理权的技能
    const managedTable = wrapper.find('[data-test="member-skills-table"]').text();
    expect(managedTable).toContain('@acme/reviewer');
    expect(managedTable).not.toContain('@acme/secret');
    expect(wrapper.find('[data-test="configure-reviewer"]').exists()).toBe(true);

    // 「共享给我的」Tab：显示可读但无管理权的技能与我的权限
    const sharedTable = wrapper.find('[data-test="member-shared-table"]').text();
    expect(sharedTable).toContain('@acme/secret');
    expect(sharedTable).toContain('只读');
    expect(wrapper.find('[data-test="member-shared-table"]').find('[data-test="configure-secret"]').exists()).toBe(false);
  });

  it('超管可见跨组织技能总览（含未发布）', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/skills/inventory') {
        return {
          status: 200,
          json: [
            { ...skills[0], status: 'active-published', access: 'manage', relation: 'managed' },
            { ...skills[2], status: 'active-unreleased', access: 'manage', relation: 'managed' }
          ]
        };
      }
      if (url === '/api/skills/acme/reviewer/permissions') {
        return { status: 200, json: matrixFor('reviewer') };
      }
      if (url === '/api/skills/other/tool/permissions') {
        return { status: 200, json: matrixFor('tool') };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(SuperSkillsView, { role: 'super', route: '/admin/super/skills' });
    await flushPromises();

    const table = wrapper.find('[data-test="super-skills-table"]').text();
    expect(table).toContain('@acme/reviewer');
    expect(table).toContain('@other/tool');
    expect(table).toContain('acme');
    expect(table).toContain('未发布');
    expect(wrapper.find('[data-test="configure-tool"]').exists()).toBe(true);
  });
});

describe('SkillPermissionsPanel 权限配置', () => {
  function mockMatrixApi(overrides: Record<string, unknown> = {}) {
    return useApiMock((method, url) => {
      if (url === '/api/skills/acme/reviewer/permissions') {
        const base = matrixFor('reviewer', { members: [{ username: 'acme_alice', permission: 'write' }] });
        return { status: 200, json: { ...base, ...overrides } };
      }
      return { status: 200, json: [] };
    });
  }

  async function mountPanel(options?: { teamOptions?: boolean }) {
    if (options?.teamOptions) {
      useApiMock((method, url) => {
        if (url === '/api/orgs/teams') {
          return { status: 200, json: [{ id: 7, name: 'frontend', permission: 'read' }] };
        }
        if (url === '/api/orgs/members') {
          return { status: 200, json: [{ username: 'acme_bob' }] };
        }
        if (url === '/api/skills/acme/reviewer/permissions') {
          if (method === 'POST') {
            return { status: 200, json: matrixFor('reviewer', { sharedAllRead: true }) };
          }
          return { status: 200, json: matrixFor('reviewer', { members: [{ username: 'acme_alice', permission: 'write' }] }) };
        }
        return { status: 200, json: [] };
      });
      wrapper = await mountConsoleView(OrgSkillPermissionsView, {
        role: 'org-admin',
        route: '/admin/org/skills/acme/reviewer/permissions'
      });
    } else {
      wrapper = await mountConsoleView(
        { components: { SkillPermissionsPanel }, template: '<SkillPermissionsPanel scope="acme" skill-name="reviewer" />' } as never,
        { role: 'member', route: '/admin/member/skills' }
      );
    }
    await flushPromises();
    return wrapper;
  }

  async function setPanelState(name: string, value: unknown): Promise<void> {
    const panel = wrapper!.findComponent(SkillPermissionsPanel);
    (panel.vm as unknown as Record<string, unknown>)[name] = value;
    await flushPromises();
  }

  it('组织共享级别控件按档位调用对应接口并实时刷新状态', async () => {
    const { requests } = mockMatrixApi({ sharedAllRead: true });
    wrapper = await mountPanel();
    const panel = wrapper.findComponent(SkillPermissionsPanel);

    await (panel.vm as unknown as { onShareLevelChange: (level: string) => Promise<void> }).onShareLevelChange('read');
    await flushPromises();
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('/api/skills/acme/reviewer/permissions');
    expect(post?.body).toEqual({ action: 'share_all_read' });
    // 响应矩阵直接刷新页面状态
    expect(wrapper.find('[data-test="share-state"]').text()).toBe('全员只读');

    await (panel.vm as unknown as { onShareLevelChange: (level: string) => Promise<void> }).onShareLevelChange('write');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'share_all_write'
    });

    await (panel.vm as unknown as { onShareLevelChange: (level: string) => Promise<void> }).onShareLevelChange('manage');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'share_all_manage'
    });

    await (panel.vm as unknown as { onShareLevelChange: (level: string) => Promise<void> }).onShareLevelChange('none');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'reset_to_private'
    });
  });

  it('成员授权提交用户名与读写权限', async () => {
    const { requests } = mockMatrixApi();
    wrapper = await mountPanel();

    const input = wrapper.find('[data-test="member-input"]').element as HTMLInputElement;
    input.value = 'acme_bob';
    await wrapper.find('[data-test="member-input"]').trigger('input');
    await setPanelState('memberPermission', 'write');
    await wrapper.find('[data-test="grant-member"]').trigger('click');
    await flushPromises();

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({ action: 'add_member', username: 'acme_bob', permission: 'write' });
  });

  it('成员授权支持管理档（manage，ADR-0025）', async () => {
    const { requests } = mockMatrixApi();
    wrapper = await mountPanel();

    const input = wrapper.find('[data-test="member-input"]').element as HTMLInputElement;
    input.value = 'acme_bob';
    await wrapper.find('[data-test="member-input"]').trigger('input');
    await setPanelState('memberPermission', 'manage');
    await wrapper.find('[data-test="grant-member"]').trigger('click');
    await flushPromises();

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({ action: 'add_member', username: 'acme_bob', permission: 'manage' });
  });

  it('团队授权通过手工输入团队名提交', async () => {
    const { requests } = mockMatrixApi({ teams: [{ id: 7, name: 'frontend', permission: 'read' }] });
    wrapper = await mountPanel();

    const input = wrapper.find('[data-test="team-input"]').element as HTMLInputElement;
    input.value = 'frontend';
    await wrapper.find('[data-test="team-input"]').trigger('input');
    await wrapper.find('[data-test="grant-team"]').trigger('click');
    await flushPromises();

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({ action: 'add_team', team: 'frontend' });
    // 已授权团队来自响应矩阵
    expect(wrapper.find('[data-test="granted-team"]').exists()).toBe(true);
  });

  it('已授权团队标签优先展示显示名,未设置回退标识名', async () => {
    mockMatrixApi({
      teams: [
        { id: 7, name: 'frontend', permission: 'read', display_name: '前端团队' },
        { id: 8, name: 'ops', permission: 'write' }
      ]
    });
    wrapper = await mountPanel();

    const granted = wrapper.findAll('[data-test="granted-team"]');
    expect(granted[0].text()).toContain('前端团队');
    expect(granted[1].text()).toContain('ops');
  });

  it('移除已授权团队与成员调用对应接口', async () => {
    const { requests } = mockMatrixApi({
      teams: [{ id: 7, name: 'frontend', permission: 'read' }],
      members: [
        { username: 'acme_alice', permission: 'write' },
        { username: 'acme_bob', permission: 'read' }
      ]
    });
    wrapper = await mountPanel();

    await wrapper.find('[data-test="revoke-team-frontend"]').trigger('click');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'remove_team',
      team: 'frontend'
    });

    await wrapper.find('[data-test="revoke-member-acme_bob"]').trigger('click');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'remove_member',
      username: 'acme_bob'
    });
  });

  it('组织管理员视角提供团队与成员下拉建议', async () => {
    wrapper = await mountPanel({ teamOptions: true });
    await flushPromises();

    expect(wrapper.find('[data-test="team-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="member-select"]').exists()).toBe(true);

    const panel = wrapper.findComponent(SkillPermissionsPanel);
    expect((panel.vm as unknown as { teamOptions: Array<{ name: string }> }).teamOptions.map((team) => team.name))
      .toEqual(['frontend']);
  });

  it('授权失败时展示错误、保留输入且状态不变', async () => {
    useApiMock((method, url) => {
      if (url === '/api/skills/acme/reviewer/permissions') {
        if (method === 'POST') {
          return { status: 403, json: { error: 'Forbidden: skill owner or organization administrator required' } };
        }
        return { status: 200, json: matrixFor('reviewer', { members: [{ username: 'acme_alice', permission: 'write' }] }) };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountPanel();

    const input = wrapper.find('[data-test="member-input"]').element as HTMLInputElement;
    input.value = 'acme_bob';
    await wrapper.find('[data-test="member-input"]').trigger('input');
    await wrapper.find('[data-test="grant-member"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.el-alert').text()).toContain('Forbidden');
    // 失败后保留输入内容，避免重新填写
    expect((wrapper.find('[data-test="member-input"]').element as HTMLInputElement).value).toBe('acme_bob');
    expect(wrapper.find('[data-test="share-state"]').text()).toBe('仅创建者');
  });

  it('自定义授权（额外成员或团队）显示自定义状态', async () => {
    const { requests } = mockMatrixApi({
      members: [
        { username: 'acme_alice', permission: 'write' },
        { username: 'acme_bob', permission: 'read' }
      ]
    });
    wrapper = await mountPanel();
    expect(wrapper.find('[data-test="share-state"]').text()).toBe('自定义');

    // 共享级别控件仍可覆盖为全员共享
    const panel = wrapper.findComponent(SkillPermissionsPanel);
    await (panel.vm as unknown as { onShareLevelChange: (level: string) => Promise<void> }).onShareLevelChange('write');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'share_all_write'
    });
  });
});

describe('deriveShareState 状态推导', () => {
  const baseMatrix = {
    scope: 'acme',
    skillName: 'reviewer',
    sharedAllRead: false,
    sharedAllWrite: false,
    sharedAllManage: false,
    teams: [] as Array<{ id: number; name: string; permission: string }>,
    members: [] as Array<{ username: string; permission: string }>
  };

  it('读写共享优先于只读共享', () => {
    expect(deriveShareState({ ...baseMatrix, sharedAllRead: true, sharedAllWrite: true }).text).toBe('全员读写');
    expect(deriveShareState({ ...baseMatrix, sharedAllRead: true }).text).toBe('全员只读');
  });

  it('全员管理档位优先于读写与只读', () => {
    expect(
      deriveShareState({ ...baseMatrix, sharedAllRead: true, sharedAllWrite: true, sharedAllManage: true }).text
    ).toBe('全员管理');
    expect(deriveShareState({ ...baseMatrix, sharedAllManage: true }).key).toBe('all-manage');
  });

  it('额外团队或成员视为自定义，否则为仅创建者', () => {
    expect(
      deriveShareState({ ...baseMatrix, teams: [{ id: 7, name: 'frontend', permission: 'read' }] }).key
    ).toBe('custom');
    expect(
      deriveShareState({
        ...baseMatrix,
        members: [
          { username: 'acme_alice', permission: 'write' },
          { username: 'acme_bob', permission: 'read' }
        ]
      }).key
    ).toBe('custom');
    expect(deriveShareState({ ...baseMatrix }).key).toBe('private');
  });
});
