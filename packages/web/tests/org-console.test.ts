import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils';
import MembersView from '../src/views/org/MembersView.vue';
import TeamsView from '../src/views/org/TeamsView.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';
import { setFetchImpl } from '../src/api/client';

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
// 服务端 /api/orgs/teams 已过滤 Owners 与三个全员团队,只返回系统管理团队与自定义团队
const teams = [
  { id: 5, name: 'system-admins', permission: 'manage', display_name: '系统管理团队' },
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

  it('添加成员后订阅 Operation 流，创建成功后才刷新列表', async () => {
    const getCalls: string[] = [];
    setFetchImpl((async (url: string | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/orgs/members' && init?.method === 'POST') {
        return new Response(JSON.stringify({ username: 'acme_zed', operationId: 42 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/orgs/members') {
        getCalls.push(path);
        return new Response(JSON.stringify(members), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/operations/42/stream') {
        getCalls.push(path);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"operationId":42,"status":"pending","error":null}\n\n'));
            controller.enqueue(encoder.encode('data: {"operationId":42,"status":"succeeded","error":null}\n\n'));
            controller.close();
          }
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    // 初始加载列表 1 次
    expect(getCalls.filter((path) => path === '/api/orgs/members')).toHaveLength(1);

    await wrapper.find('[data-test="open-add-member"]').trigger('click');
    await flushPromises();
    await setDocInput('add-member-username', 'zed');
    await doc('add-member-submit').trigger('click');
    await flushPromises();

    // 订阅了 Operation 状态流
    expect(getCalls.some((path) => path === '/api/operations/42/stream')).toBe(true);
    // 收到 succeeded 后才再次刷新成员列表
    await vi.waitFor(() => {
      expect(getCalls.filter((path) => path === '/api/orgs/members')).toHaveLength(2);
    });
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

  it('组织管理员自身行显示管理员标识且无禁用按钮', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/members') {
        return {
          status: 200,
          json: [
            { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' },
            { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }
          ]
        };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    // 管理员自身:显示"管理员"标识,不提供禁用按钮
    expect(wrapper.find('[data-test="admin-badge"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="disable-acme_admin"]').exists()).toBe(false);
    // 普通成员:仍有禁用按钮
    expect(wrapper.find('[data-test="disable-acme_bob"]').exists()).toBe(true);
  });

  it('禁用成员后订阅 Operation 流，成功后刷新在册与已禁用列表', async () => {
    const getCalls: string[] = [];
    setFetchImpl((async (url: string | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/orgs/members/bob/disable' && init?.method === 'POST') {
        return new Response(JSON.stringify({ username: 'acme_bob', operationId: 50 }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/orgs/members/disabled') {
        getCalls.push(path);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/orgs/members') {
        getCalls.push(path);
        return new Response(JSON.stringify(members), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/operations/50/stream') {
        getCalls.push(path);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"operationId":50,"status":"pending","error":null}\n\n'));
            controller.enqueue(encoder.encode('data: {"operationId":50,"status":"succeeded","error":null}\n\n'));
            controller.close();
          }
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    // 初始加载:在册与已禁用列表各 1 次
    expect(getCalls.filter((path) => path === '/api/orgs/members')).toHaveLength(1);

    await doc('disable-acme_bob').trigger('click');
    await flushPromises();
    await doc('disable-member-confirm').trigger('click');
    await flushPromises();

    // 订阅了 Operation 状态流
    expect(getCalls.some((path) => path === '/api/operations/50/stream')).toBe(true);
    // 收到 succeeded 后才同时刷新两个列表
    await vi.waitFor(() => {
      expect(getCalls.filter((path) => path === '/api/orgs/members')).toHaveLength(2);
      expect(getCalls.filter((path) => path === '/api/orgs/members/disabled')).toHaveLength(2);
    });
  });

  it('已禁用成员从列表直接启用，无需手输用户名', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/members/zed/enable' && method === 'POST') {
        return { status: 202, json: { username: 'acme_zed', operationId: 8 } };
      }
      if (url === '/api/orgs/members') {
        return { status: 200, json: members };
      }
      if (url === '/api/orgs/members/disabled') {
        return { status: 200, json: [{ id: 2, username: 'acme_zed', email: 'acme_zed@local.esl' }] };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(MembersView, { role: 'org-admin', route: '/admin/org/members' });
    await flushPromises();

    // 有禁用成员时出现"已禁用"tab,每行带启用按钮,无需手输用户名
    expect(document.querySelector('[data-test="disabled-members-tab"]')).not.toBeNull();
    expect(document.querySelector('[data-test="enable-acme_zed"]')).not.toBeNull();

    await doc('enable-acme_zed').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'POST' && request.url === '/api/orgs/members/zed/enable'))
      .toBe(true);
  });
});

describe('TeamsView 团队管理', () => {
  it('系统管理团队删除按钮置灰且无删除弹窗', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    // 团队管理页只列系统管理团队(默认)与自定义团队;系统管理团队不可删除
    expect((wrapper.find('[data-test="delete-team-system-admins"]').element as HTMLButtonElement).disabled).toBe(true);
    expect((wrapper.find('[data-test="delete-team-frontend"]').element as HTMLButtonElement).disabled).toBe(false);
    // 置灰按钮点击不触发请求
    await wrapper.find('[data-test="delete-team-system-admins"]').trigger('click');
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
    // ADR-0029:创建请求携带可选的显示名字段(留空即不设置)
    expect(createRequest?.body).toEqual({ name: 'backend', permission: 'write', display_name: '' });
  });

  it('团队管理列表两列展示显示名与标识名', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    // 系统管理团队显示预置中文显示名;自定义团队未设置显示名显示「—」
    expect(wrapper.text()).toContain('系统管理团队');
    expect(wrapper.text()).toContain('system-admins');
    expect(wrapper.text()).toContain('—');
  });

  it('编辑团队:修改显示名不触发权限确认,保存后提交三个字段', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    await wrapper.find('[data-test="edit-team-frontend"]').trigger('click');
    await flushPromises();
    await setDocInput('edit-team-display-name', '前端团队');
    await doc('edit-team-confirm').trigger('click');
    await flushPromises();

    const patch = requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'frontend', permission: 'read', display_name: '前端团队' });
  });

  it('编辑团队:改权限级别需二次确认,取消则不提交', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    await wrapper.find('[data-test="edit-team-frontend"]').trigger('click');
    await flushPromises();
    const manageRadio = doc('edit-team-permission').find('input[value="manage"]');
    (manageRadio.element as HTMLInputElement).checked = true;
    await manageRadio.trigger('change');
    await doc('edit-team-confirm').trigger('click');
    await flushPromises();

    // 权限档变化弹二次确认(ElMessageBox 渲染到 body)
    const cancelBtn = document.querySelector('.el-message-box__btns .el-button:not(.el-button--primary)');
    expect(cancelBtn).not.toBeNull();
    expect(requests.some((request) => request.method === 'PATCH')).toBe(false);
    (cancelBtn as HTMLButtonElement).click();
    await flushPromises();
    expect(requests.some((request) => request.method === 'PATCH')).toBe(false);
  });

  it('编辑团队:改权限级别确认后提交 manage 档', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    await wrapper.find('[data-test="edit-team-frontend"]').trigger('click');
    await flushPromises();
    const manageRadio = doc('edit-team-permission').find('input[value="manage"]');
    (manageRadio.element as HTMLInputElement).checked = true;
    await manageRadio.trigger('change');
    await doc('edit-team-confirm').trigger('click');
    await flushPromises();

    const confirmBtn = document.querySelector('.el-message-box__btns .el-button--primary');
    (confirmBtn as HTMLButtonElement).click();
    await flushPromises();

    const patch = requests.find((request) => request.method === 'PATCH');
    expect(patch?.body).toEqual({ name: 'frontend', permission: 'manage', display_name: '' });
  });

  it('系统管理团队面板中组织管理员行不可移除', async () => {
    useApiMock((method, url) => {
      if (url === '/api/orgs/teams') {
        return { status: 200, json: teams };
      }
      if (url === '/api/orgs/teams/5/members') {
        return {
          status: 200,
          json: [
            { id: 1, username: 'acme_admin', email: 'acme_admin@local.esl' },
            { id: 3, username: 'acme_bob', email: 'acme_bob@local.esl' }
          ]
        };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(TeamsView, { role: 'org-admin', route: '/admin/org/teams' });
    await flushPromises();

    // 展开第 1 行（system-admins）加载团队成员面板
    await wrapper.findAll('.el-table__expand-icon')[0].trigger('click');
    await flushPromises();

    expect(document.querySelector('[data-test="team-members-system-admins"]')).not.toBeNull();
    // 组织管理员自身:显示"管理员"标识,无移除按钮(ADR-0026:admin 自动加入且不可移出)
    expect(document.querySelector('[data-test="owner-admin-badge"]')).not.toBeNull();
    expect(document.querySelector('[data-test="team-remove-acme_admin"]')).toBeNull();
    // 普通成员:仍有移除按钮
    expect(document.querySelector('[data-test="team-remove-acme_bob"]')).not.toBeNull();
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

    // 展开第 2 行（frontend,自定义团队）加载团队成员面板
    await wrapper.findAll('.el-table__expand-icon')[1].trigger('click');
    await flushPromises();

    expect(document.querySelector('[data-test="team-members-frontend"]')).not.toBeNull();

    await doc('team-remove-acme_bob').trigger('click');
    await flushPromises();
    expect(
      requests.some((request) => request.method === 'DELETE' && request.url === '/api/orgs/teams/7/members/bob')
    ).toBe(true);

    // 移除后父列表刷新，展开行折叠；重新展开再添加成员
    await wrapper.findAll('.el-table__expand-icon')[1].trigger('click');
    await flushPromises();
    await setDocInput('team-add-username', 'zed');
    await doc('team-add-submit').trigger('click');
    await flushPromises();
    expect(
      requests.some((request) => request.method === 'POST' && request.url === '/api/orgs/teams/7/members')
    ).toBe(true);
  });
});
