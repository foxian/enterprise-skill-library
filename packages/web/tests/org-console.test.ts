import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils';
import MembersView from '../src/views/org/MembersView.vue';
import TeamsView from '../src/views/org/TeamsView.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

// el-dialog 内容渲染在 body 的 teleport 层，从 document 查找
function doc(testId: string): DOMWrapper<Element> {
  const element = document.querySelector(`[data-test="${testId}"]`);
  if (!element) {
    throw new Error(`[data-test="${testId}"] not found in document`);
  }
  return new DOMWrapper(element);
}

function docInputValue(testId: string): string {
  return (doc(testId).element as HTMLInputElement).value;
}

async function setDocInput(testId: string, value: string): Promise<void> {
  const input = doc(testId).element as HTMLInputElement;
  input.value = value;
  await doc(testId).trigger('input');
}

const members = [{ id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }];
const teams = [
  { id: 1, name: 'Owners', permission: 'owner' },
  { id: 2, name: 'all-readers', permission: 'read' },
  { id: 3, name: 'all-writers', permission: 'write' },
  { id: 7, name: 'frontend', permission: 'read' }
];

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

describe('MembersView 成员管理', () => {
  it('添加成员自动生成初始密码并一次性展示', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members') {
        if (method === 'POST') {
          return { status: 201, json: { username: 'acme_zed', password: 'generated-pass' } };
        }
        return { status: 200, json: members };
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

    const addRequest = requests.find((request) => request.method === 'POST' && request.url === '/api/orgs/members');
    expect(addRequest?.body).toEqual({ username: 'zed' });
    expect(docInputValue('one-time-password')).toBe('generated-pass');
    // 添加后列表刷新
    const listFetches = requests.filter((request) => request.method === 'GET' && request.url === '/api/orgs/members');
    expect(listFetches.length).toBeGreaterThanOrEqual(2);
  });

  it('指定初始密码时不弹一次性密码弹窗', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members') {
        if (method === 'POST') {
          return { status: 201, json: { username: 'acme_zed' } };
        }
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'zed');
    await setDocInput('add-member-password', 'explicit-pass');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    expect(document.querySelector('[data-test="one-time-password"]')).toBeNull();
    const addRequest = requests.find((request) => request.method === 'POST' && request.url === '/api/orgs/members');
    expect(addRequest?.body).toEqual({ username: 'zed', password: 'explicit-pass' });
  });

  it('无效成员用户名复用核心校验规则且不发起请求', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'Bad_Name');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(wrapper.find('.page-error').text()).toContain('lowercase letters');
  });

  it('低于策略最小长度的初始密码不发起请求', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'zed');
    await setDocInput('add-member-password', 'short-pass');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(wrapper.find('.page-error').text()).toContain('password must be at least');
  });

  it('重置密码时自动生成并一次性展示新密码', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/members/bob/password' && method === 'POST') {
        return { status: 200, json: { username: 'acme_bob', password: 'reset-pass' } };
      }
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="reset-password-acme_bob"]').trigger('click');
    await flushPromises();
    await doc('reset-password-submit').trigger('click');
    await flushPromises();

    expect(docInputValue('one-time-password')).toBe('reset-pass');
  });

  it('禁用成员需要弹窗确认', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members/bob/disable' && method === 'POST') {
        return { status: 200, json: { username: 'acme_bob', disabled: true } };
      }
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="disable-acme_bob"]').trigger('click');
    await flushPromises();
    // 弹窗打开但尚未请求
    expect(requests.some((request) => request.url === '/api/orgs/members/bob/disable')).toBe(false);

    await doc('disable-member-confirm').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'POST' && request.url === '/api/orgs/members/bob/disable'))
      .toBe(true);
  });

  it('启用成员按输入的用户名调用 enable 接口', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members/zed/enable' && method === 'POST') {
        return { status: 200, json: { username: 'acme_zed', enabled: true } };
      }
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    await wrapper.find('[data-test="open-enable-member"]').trigger('click');
    await flushPromises();
    await setDocInput('enable-member-username', 'zed');
    await doc('enable-member-submit').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'POST' && request.url === '/api/orgs/members/zed/enable'))
      .toBe(true);
  });
});

describe('TeamsView 团队管理', () => {
  it('默认团队删除按钮置灰且无删除弹窗', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    expect((wrapper.find('[data-test="delete-team-all-readers"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((wrapper.find('[data-test="delete-team-frontend"]').element as HTMLButtonElement).disabled).toBe(false);
    // 置灰按钮点击不触发请求
    await wrapper.find('[data-test="delete-team-all-readers"]').trigger('click');
    await flushPromises();
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    expect(wrapper.find('[data-test="default-team-tag"]').exists()).toBe(true);
  });

  it('新建团队携带只读/读写权限级别', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        if (method === 'POST') {
          return { status: 201, json: { id: 9, name: 'backend', permission: 'write' } };
        }
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    await wrapper.find('[data-test="open-create-team"]').trigger('click');
    await flushPromises();
    await setDocInput('new-team-name', 'backend');
    const writeRadio = doc('new-team-permission').find('input[value="write"]');
    (writeRadio.element as HTMLInputElement).checked = true;
    await writeRadio.trigger('change');
    await doc('create-team-submit').trigger('click');
    await flushPromises();

    const createRequest = requests.find((request) => request.method === 'POST' && request.url === '/api/orgs/teams');
    expect(createRequest?.body).toEqual({ name: 'backend', permission: 'write' });
  });

  it('删除自定义团队需弹窗确认', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams/7' && method === 'DELETE') {
        return { status: 200, json: { deleted: true } };
      }
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    await wrapper.find('[data-test="delete-team-frontend"]').trigger('click');
    await flushPromises();
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);

    await doc('delete-team-confirm').trigger('click');
    await flushPromises();
    expect(requests.some((request) => request.method === 'DELETE' && request.url === '/api/orgs/teams/7')).toBe(true);
  });

  it('团队详情面板支持添加与移除成员', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      if (url === '/api/orgs/teams/7/members') {
        if (method === 'POST') {
          return { status: 201, json: { teamId: 7, username: 'acme_zed' } };
        }
        if (method === 'DELETE') {
          return { status: 200, json: { teamId: 7, username: 'acme_bob', removed: true } };
        }
        return { status: 200, json: members };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    // 展开第 4 行（frontend）加载团队成员面板
    await wrapper.findAll('.el-table__expand-icon')[3].trigger('click');
    await flushPromises();

    expect(document.querySelector('[data-test="team-members-frontend"]')).not.toBeNull();

    await doc('team-remove-acme_bob').trigger('click');
    await flushPromises();
    expect(
      requests.some((request) => request.method === 'DELETE' && request.url === '/api/orgs/teams/7/members/bob')
    ).toBe(true);

    // 移除后父列表刷新，展开行折叠；重新展开再添加成员
    await wrapper.findAll('.el-table__expand-icon')[3].trigger('click');
    await flushPromises();
    await setDocInput('team-add-username', 'zed');
    await doc('team-add-submit').trigger('click');
    await flushPromises();
    expect(
      requests.some((request) => request.method === 'POST' && request.url === '/api/orgs/teams/7/members')
    ).toBe(true);
  });
});
