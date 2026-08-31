import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import SkillPermissionsPanel from '../src/components/SkillPermissionsPanel.vue';
import OrgSkillsView from '../src/views/org/SkillsView.vue';
import MemberSkillsView from '../src/views/member/SkillsView.vue';
import OrgSkillPermissionsView from '../src/views/org/SkillPermissionsView.vue';
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
  it('组织管理员可见全组织技能及共享状态', async () => {
    useApiMock((method, url) => {
      if (url === '/api/skills/search?q=') {
        return { status: 200, json: skills };
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
    expect(table).not.toContain('@other/tool');
    expect(wrapper.find('[data-test="skill-state-reviewer"]').text()).toBe('全员只读');
    expect(wrapper.find('[data-test="skill-state-secret"]').text()).toBe('仅创建者');
  });

  it('成员只能看到自己创建的技能', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/skills/search?q=') {
        return { status: 200, json: skills };
      }
      if (url === '/api/skills/acme/reviewer/permissions') {
        return { status: 200, json: matrixFor('reviewer') };
      }
      if (url === '/api/skills/acme/secret/permissions') {
        return { status: 200, json: matrixFor('secret') };
      }
      return { status: 200, json: [] };
    });
    // member 角色默认账号是 acme 组织的 bob，创建者为 acme_zed 的 secret 也不可见
    wrapper = await mountConsoleView(MemberSkillsView, { role: 'member', route: '/admin/member/skills' });
    await flushPromises();

    const table = wrapper.find('[data-test="member-skills-table"]').text();
    expect(table).not.toContain('@acme/reviewer');
    expect(table).not.toContain('@acme/secret');
    expect(table).not.toContain('@other/tool');

    // bob 自己创建的技能可见
    wrapper?.unmount();
    useApiMock((_method, url) => {
      if (url === '/api/skills/search?q=') {
        return { status: 200, json: [{ ...skills[0], createdBy: 'acme_bob', owner: 'acme_bob' }] };
      }
      if (url === '/api/skills/acme/reviewer/permissions') {
        return { status: 200, json: matrixFor('reviewer', { members: [{ username: 'acme_bob', permission: 'write' }] }) };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MemberSkillsView, { role: 'member', route: '/admin/member/skills' });
    await flushPromises();
    expect(wrapper.find('[data-test="member-skills-table"]').text()).toContain('@acme/reviewer');
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

  it('快捷按钮调用全员共享与重置接口并实时刷新状态', async () => {
    const { requests } = mockMatrixApi({ sharedAllRead: true });
    wrapper = await mountPanel();

    await wrapper.find('[data-test="share-all-read"]').trigger('click');
    await flushPromises();

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('/api/skills/acme/reviewer/permissions');
    expect(post?.body).toEqual({ action: 'share_all_read' });
    // 响应矩阵直接刷新页面状态
    expect(wrapper.find('[data-test="share-state"]').text()).toBe('全员只读');

    await wrapper.find('[data-test="share-all-write"]').trigger('click');
    await flushPromises();
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      action: 'share_all_write'
    });

    await wrapper.find('[data-test="reset-to-private"]').trigger('click');
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

    // 快捷按钮仍可覆盖为全员共享
    await wrapper.find('[data-test="share-all-write"]').trigger('click');
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
    teams: [] as Array<{ id: number; name: string; permission: string }>,
    members: [] as Array<{ username: string; permission: string }>
  };

  it('读写共享优先于只读共享', () => {
    expect(deriveShareState({ ...baseMatrix, sharedAllRead: true, sharedAllWrite: true }).text).toBe('全员读写');
    expect(deriveShareState({ ...baseMatrix, sharedAllRead: true }).text).toBe('全员只读');
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
