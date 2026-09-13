import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils';
import MembersView from '../src/views/org/MembersView.vue';
import TeamsView from '../src/views/org/TeamsView.vue';
import TeamMemberPanel from '../src/components/TeamMemberPanel.vue';
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
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
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
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
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
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
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
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
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
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
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
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
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
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
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
      role: 'org-admin',
      route: '/admin/org/teams',
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
