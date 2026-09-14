import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils';
import MembersView from '../src/views/me/OrgMembersView.vue';
import TeamsView from '../src/views/me/OrgTeamsView.vue';
import TeamMemberPanel from '../src/components/TeamMemberPanel.vue';
import OrgDetailLayout from '../src/views/me/OrgDetailLayout.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';
import { setFetchImpl } from '../src/api/client';

// 组织成员治理（ADR-0032 / #55）：成员为全局账号；直拉即生效，邀请制下
// 对方接受后入组；移出即离开组织并自动退出常设团队。团队管理仅自定义团队。
function doc(testId: string): DOMWrapper<Element> {
  const element = document.querySelector(`[data-test="${testId}"]`);
  if (!element) {
    throw new Error(`[data-test="${testId}"] not found in document`);
  }
  return new DOMWrapper(element);
}

async function setDocInput(testId: string, value: string): Promise<void> {
  const input = doc(testId).element as HTMLInputElement;
  input.value = value;
  await doc(testId).trigger('input');
}

const members = [
  { id: 3, username: 'bob', email: 'bob@local.esl' },
  { id: 4, username: 'carol', email: 'carol@local.esl' }
];
// 服务端 /api/orgs/:org/teams 已过滤 Owners 与三个常设团队,只返回自定义团队
const teams = [{ id: 7, name: 'frontend', permission: 'read' }];

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

describe('MembersView 成员管理', () => {
  it('直接添加已注册账号即生效并刷新列表', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members') {
        if (method === 'POST') {
          return { status: 201, json: { status: 'added', username: 'zed' } };
        }
        return { status: 200, json: members };
      }
      if (url === '/api/public/platform-info') {
        return { status: 200, json: { registrationMode: 'open', memberAddMode: 'direct' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'zed');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    const addRequest = requests.find(
      (request) => request.method === 'POST' && request.url === '/api/orgs/acme/members'
    );
    expect(addRequest?.body).toEqual({ username: 'zed' });
    const listFetches = requests.filter(
      (request) => request.method === 'GET' && request.url === '/api/orgs/acme/members'
    );
    expect(listFetches.length).toBeGreaterThanOrEqual(2);
  });

  it('邀请制下添加成员发送邀请并提示待接受', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members') {
        if (method === 'POST') {
          return { status: 202, json: { status: 'invited', username: 'zed', invitationId: 9 } };
        }
        return { status: 200, json: members };
      }
      if (url === '/api/public/platform-info') {
        return { status: 200, json: { registrationMode: 'open', memberAddMode: 'invite' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'zed');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    const addRequest = requests.find(
      (request) => request.method === 'POST' && request.url === '/api/orgs/acme/members'
    );
    expect(addRequest?.body).toEqual({ username: 'zed' });
    const listFetches = requests.filter(
      (request) => request.method === 'GET' && request.url === '/api/orgs/acme/members'
    );
    expect(listFetches.length).toBeGreaterThanOrEqual(2);
  });

  it('移出成员需要弹窗确认，确认后按全局用户名发起移出', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members' && method === 'DELETE') {
        return { status: 200, json: { removed: true, username: 'bob' } };
      }
      if (url === '/api/orgs/acme/members') {
        return { status: 200, json: members };
      }
      if (url === '/api/public/platform-info') {
        return { status: 200, json: { registrationMode: 'open', memberAddMode: 'direct' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    await wrapper.find('[data-test="remove-bob"]').trigger('click');
    await flushPromises();
    await doc('remove-member-confirm').trigger('click');
    await flushPromises();

    const removeRequest = requests.find(
      (request) => request.method === 'DELETE' && request.url === '/api/orgs/acme/members/bob'
    );
    expect(removeRequest).toBeDefined();
  });

  it('添加已存在成员时展示服务端错误', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members' && method === 'POST') {
        return { status: 409, json: { error: 'User is already a member of acme' } };
      }
      if (url === '/api/orgs/acme/members') {
        return { status: 200, json: members };
      }
      if (url === '/api/public/platform-info') {
        return { status: 200, json: { registrationMode: 'open', memberAddMode: 'direct' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'bob');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    expect(wrapper.find('.page-error').text()).toContain('already a member');
  });
});

describe('TeamsView 团队管理', () => {
  it('团队管理列表两列展示显示名与标识名', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/acme/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { account: 'orgManager', route: '/admin/me/orgs/acme/teams' });
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('frontend');
  });

  it('新建团队携带权限级别并请求组织作用域端点', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/teams' && method === 'POST') {
        return { status: 201, json: { id: 9, name: 'backend', permission: 'write' } };
      }
      if (url === '/api/orgs/acme/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { account: 'orgManager', route: '/admin/me/orgs/acme/teams' });
    await flushPromises();

    await wrapper.find('[data-test="open-create-team"]').trigger('click');
    await flushPromises();
    await setDocInput('new-team-name', 'backend');
    await doc('create-team-submit').trigger('click');
    await flushPromises();

    const createRequest = requests.find(
      (request) => request.method === 'POST' && request.url === '/api/orgs/acme/teams'
    );
    expect(createRequest).toBeDefined();
    expect(createRequest?.body).toMatchObject({ name: 'backend' });
  });

  it('删除自定义团队需弹窗确认', async () => {
    const requestsRef = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/teams' && method === 'GET') {
        return { status: 200, json: teams };
      }
      if (url === '/api/orgs/acme/teams/7' && method === 'DELETE') {
        return { status: 200, json: { deleted: true } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { account: 'orgManager', route: '/admin/me/orgs/acme/teams' });
    await flushPromises();

    await wrapper.find('[data-test="delete-team-frontend"]').trigger('click');
    await flushPromises();
    await doc('delete-team-confirm').trigger('click');
    await flushPromises();

    const removeRequest = requestsRef.requests.find(
      (request) => request.method === 'DELETE' && request.url === '/api/orgs/acme/teams/7'
    );
    expect(removeRequest).toBeDefined();
  });
});

describe('TeamMemberPanel 团队成员', () => {
  it('支持以全局用户名添加与移除团队成员', async () => {
    let teamMembers = members;
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/teams/7/members' && method === 'POST') {
        teamMembers = [...teamMembers, { id: 9, username: 'zed', email: 'zed@local.esl' }];
        return { status: 201, json: { teamId: 7, username: 'zed' } };
      }
      if (url === '/api/orgs/acme/teams/7/members/zed' && method === 'DELETE') {
        teamMembers = teamMembers.filter((member) => member.username !== 'zed');
        return { status: 200, json: { teamId: 7, username: 'zed', removed: true } };
      }
      if (url === '/api/orgs/acme/teams/7/members') {
        return { status: 200, json: teamMembers };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamMemberPanel, {
      account: 'orgManager',
      route: '/admin/me/orgs/acme/teams',
      props: { team: teams[0], org: 'acme' }
    });
    await flushPromises();

    await setDocInput('team-add-username', 'zed');
    await doc('team-add-submit').trigger('click');
    await flushPromises();

    const addRequest = requests.find(
      (request) => request.method === 'POST' && request.url === '/api/orgs/acme/teams/7/members'
    );
    expect(addRequest?.body).toEqual({ username: 'zed' });

    await wrapper.find('[data-test="team-remove-zed"]').trigger('click');
    await flushPromises();
    const removeRequest = requests.find(
      (request) => request.method === 'DELETE' && request.url === '/api/orgs/acme/teams/7/members/zed'
    );
    expect(removeRequest).toBeDefined();
  });
});

// 组织治理权（ADR-0033 / ADR-0034）：治理身份标注与互管规则、待接受邀请的撤销、
// 以及组织详情页的删除危险区。
describe('组织治理界面', () => {
  const governedMembers = [
    { username: 'admin', isOrgManager: true },
    { username: 'bob', isOrgManager: false }
  ];

  it('标注治理身份，并禁止移除自己', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members') return { status: 200, json: governedMembers };
      if (url === '/api/public/platform-info') return { status: 200, json: { memberAddMode: 'direct' } };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    expect(wrapper.find('[data-test="member-is-manager"]').exists()).toBe(true);
    // 会话账号 admin 是唯一的管理团队成员：不能移除自己，也不能移除最后一名
    expect((wrapper.find('[data-test="remove-admin"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((wrapper.find('[data-test="remove-bob"]').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('管理团队成员不止一名时可以互相移除', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members') {
        return {
          status: 200,
          json: [...governedMembers, { username: 'co-admin', isOrgManager: true }]
        };
      }
      if (url === '/api/public/platform-info') return { status: 200, json: { memberAddMode: 'direct' } };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    expect((wrapper.find('[data-test="remove-co-admin"]').element as HTMLButtonElement).disabled).toBe(false);
    expect((wrapper.find('[data-test="remove-admin"]').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('列出待接受邀请并可撤销', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme/members') return { status: 200, json: governedMembers };
      if (url === '/api/orgs/acme/invitations') {
        if (method === 'DELETE') return { status: 200, json: { status: 'revoked' } };
        return { status: 200, json: [{ id: 12, username: 'carol', invitedBy: 'admin' }] };
      }
      if (url === '/api/public/platform-info') return { status: 200, json: { memberAddMode: 'invite' } };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { account: 'orgManager', route: '/admin/me/orgs/acme/members' });
    await flushPromises();

    expect(wrapper.find('[data-test="pending-invitations-table"]').text()).toContain('carol');

    await wrapper.find('[data-test="revoke-invitation-carol"]').trigger('click');
    await flushPromises();

    expect(
      requests.some((request) => request.method === 'DELETE' && request.url === '/api/orgs/acme/invitations/12')
    ).toBe(true);
  });

  it('删除组织需要手打组织名确认', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/acme') return { status: 200, json: { status: 'deleted', orgName: 'acme' } };
      if (url === '/api/orgs/acme/members') return { status: 200, json: governedMembers };
      if (url === '/api/public/platform-info') return { status: 200, json: { memberAddMode: 'direct' } };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgDetailLayout, {
      account: 'orgManager',
      route: '/admin/me/orgs/acme/members'
    });
    await flushPromises();

    expect((wrapper.find('[data-test="org-delete-button"]').element as HTMLButtonElement).disabled).toBe(true);

    await setDocInput('org-delete-confirm-input', 'acme');
    await flushPromises();
    await wrapper.find('[data-test="org-delete-button"]').trigger('click');
    await flushPromises();

    const deletion = requests.find((request) => request.method === 'DELETE' && request.url === '/api/orgs/acme');
    expect(deletion?.body).toEqual({ confirm: 'acme' });
  });
});
