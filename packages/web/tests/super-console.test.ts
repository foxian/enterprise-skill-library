import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { router } from '../src/router';
import ApplicationsView from '../src/views/super/ApplicationsView.vue';
import OrgDetailView from '../src/views/super/OrgDetailView.vue';
import OrgsView from '../src/views/super/OrgsView.vue';
import SettingsView from '../src/views/super/SettingsView.vue';
import SuperRegistrations from '../src/views/super/RegistrationsView.vue';
import DashboardView from '../src/views/super/DashboardView.vue';
import { mountConsoleView, resetConsole, useApiMock, type RecordedRequest } from './helpers';
import * as clientApi from '../src/api/client';

// 组件里通过 openOperationStream 订阅开通状态流;测试中 stub 它,按场景手动推送
// succeeded / permanently_failed,从而精确控制"等待激活后关闭对话框"的时序。
vi.mock('../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/client')>();
  return {
    ...actual,
    openOperationStream: vi.fn(),
  };
});

const applications = [
  {
    id: 1,
    orgName: 'alpha',
    adminDisplayName: 'Alice',
    status: 'pending',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z'
  },
  {
    id: 2,
    orgName: 'beta',
    adminDisplayName: 'Bob',
    status: 'approved',
    createdAt: '2026-08-02T10:00:00Z',
    updatedAt: '2026-08-03T10:00:00Z'
  }
];

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  await resetConsole();
});

describe('ApplicationsView 审批工作台', () => {
  it('默认只展示待审批申请', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs/applications') {
        return { status: 200, json: applications };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    expect(wrapper.find('[data-test="applications-table"]').text()).toContain('alpha');
    expect(wrapper.find('[data-test="applications-table"]').text()).not.toContain('beta');
  });

  it('批准申请后同步开通并刷新列表', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/orgs/applications' && method === 'GET') {
        return { status: 200, json: applications };
      }
      if (url === '/api/admin/orgs/applications/1/approve') {
        return { status: 200, json: { status: 'active', orgName: 'alpha', applicant: 'alice' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    await wrapper.find('[data-test="approve-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/orgs/applications/1/approve'
    );
    // 操作后列表刷新（再次 GET）
    const listFetches = requests.filter(
      (request: RecordedRequest) => request.method === 'GET' && request.url === '/api/admin/orgs/applications'
    );
    expect(listFetches.length).toBeGreaterThanOrEqual(2);
  });

  it('拒绝待审批申请后调用拒绝接口', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/orgs/applications') {
        return { status: 200, json: applications };
      }
      if (url === '/api/admin/orgs/applications/1/reject') {
        return { status: 200, json: { status: 'rejected', orgName: 'alpha' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    await wrapper.find('[data-test="reject-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/orgs/applications/1/reject'
    );
  });

  it('取消待审批申请后调用取消接口', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/orgs/applications') {
        return { status: 200, json: applications };
      }
      if (url === '/api/admin/orgs/applications/1/cancel') {
        return { status: 200, json: { status: 'cancelled', orgName: 'alpha' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    await wrapper.find('[data-test="cancel-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/orgs/applications/1/cancel'
    );
  });

  it('取消与过期状态以中文标签区分展示', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs/applications') {
        return {
          status: 200,
          json: [
            ...applications,
            { id: 3, orgName: 'gamma', adminDisplayName: 'Cara', status: 'cancelled', createdAt: '', updatedAt: '' },
            { id: 4, orgName: 'delta', adminDisplayName: 'Dan', status: 'expired', createdAt: '', updatedAt: '' }
          ]
        };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    const vm = wrapper.vm as unknown as { statusFilter: string };
    vm.statusFilter = 'all';
    await flushPromises();

    const text = wrapper.find('[data-test="applications-table"]').text();
    expect(text).toContain('已取消');
    expect(text).toContain('已过期');
  });

  it('切换筛选可查看历史记录', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs/applications') {
        return { status: 200, json: applications };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { account: 'platformAdmin', route: '/admin/super/applications' });
    await flushPromises();

    // el-select 下拉渲染在 body 上的 teleport 层，直接驱动状态后校验表格输出
    const vm = wrapper.vm as unknown as { statusFilter: string };
    vm.statusFilter = 'approved';
    await flushPromises();

    const text = wrapper.find('[data-test="applications-table"]').text();
    expect(text).toContain('beta');
    expect(text).not.toContain('alpha');
  });
});

describe('RegistrationsView 用户注册审批', () => {
  const pending = [
    { id: 1, username: 'erin', status: 'pending', createdAt: '2026-09-14T08:00:00Z' }
  ];

  it('默认展示待审批账号并可批准', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/registrations?status=pending' && method === 'GET') {
        return { status: 200, json: pending };
      }
      if (url === '/api/admin/registrations/1/approve') {
        return { status: 200, json: { status: 'approved', username: 'erin' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(SuperRegistrations, { account: 'platformAdmin', route: '/admin/super/registrations' });
    await flushPromises();

    expect(wrapper.find('[data-test="registrations-table"]').text()).toContain('erin');
    expect(wrapper.find('[data-test="registration-status-1"]').text()).toContain('待审批');

    await wrapper.find('[data-test="approve-registration-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/registrations/1/approve'
    );
  });

  it('拒绝待审批账号后调用拒绝接口', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/registrations?status=pending' && method === 'GET') {
        return { status: 200, json: pending };
      }
      if (url === '/api/admin/registrations/1/reject') {
        return { status: 200, json: { status: 'rejected', username: 'erin' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(SuperRegistrations, { account: 'platformAdmin', route: '/admin/super/registrations' });
    await flushPromises();

    await wrapper.find('[data-test="reject-registration-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/registrations/1/reject'
    );
  });
});

describe('OrgsView 组织生命周期状态展示', () => {
  const lifecycleOrgs = [
    { name: 'alpha', memberCount: 1, skillCount: 0, status: 'pending', lastError: null },
    { name: 'beta', memberCount: 2, skillCount: 1, status: 'active', lastError: null },
    { name: 'gamma', memberCount: 2, skillCount: 1, status: 'failed', lastError: 'initialization failed' },
    { name: 'delta', memberCount: 3, skillCount: 2, status: 'deleting', lastError: null },
    { name: 'omega', memberCount: 3, skillCount: 2, status: 'delete_failed', lastError: 'external repo found' }
  ];

  it('区分展示开通中、已激活、失败、删除中与删除失败状态', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs') {
        return { status: 200, json: lifecycleOrgs };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgsView, { account: 'platformAdmin', route: '/admin/super/orgs' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-status-alpha"]').text()).toContain('待审批');
    expect(wrapper.find('[data-test="org-status-beta"]').text()).toContain('已激活');
    expect(wrapper.find('[data-test="org-status-gamma"]').text()).toContain('开通失败');
    expect(wrapper.find('[data-test="org-status-delta"]').text()).toContain('删除中');
    expect(wrapper.find('[data-test="org-status-omega"]').text()).toContain('删除失败');
  });

  
  
  
  });

describe('OrgDetailView 组织详情', () => {
  const orgs = [{ name: 'acme', memberCount: 3, skillCount: 2, createdAt: '2026-08-01T10:00:00Z' }];

  function mockOrgsApi(extra: Record<string, unknown> = {}) {
    return useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') {
        return { status: 200, json: orgs.map((org) => ({ ...org, status: null, lastError: null, ...extra })) };
      }
      if (url === '/api/admin/orgs/acme' && method === 'DELETE') {
        return { status: 200, json: { deleted: true, orgName: 'acme' } };
      }
      return { status: 200, json: [] };
    });
  }

  it('失败的组织展示失败原因', async () => {
    mockOrgsApi({ status: 'failed', lastError: 'initialization failed' });
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').text()).toContain('initialization failed');
  });

  it('删除失败的组织展示失败原因（重新发起删除即重试）', async () => {
    mockOrgsApi({ status: 'delete_failed', lastError: 'external repo found' });
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').text()).toContain('external repo found');
  });

  it('激活状态的组织不展示失败原因', async () => {
    mockOrgsApi({ status: 'active', lastError: null });
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').exists()).toBe(false);
  });
});

describe('OrgDetailView 删除组织二次确认', () => {
  const orgs = [{ name: 'acme', memberCount: 3, skillCount: 2, createdAt: '2026-08-01T10:00:00Z' }];

  function mockOrgsApi() {
    return useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') {
        return { status: 200, json: orgs };
      }
      if (url === '/api/admin/orgs/acme' && method === 'DELETE') {
        return { status: 200, json: { deleted: true, orgName: 'acme' } };
      }
      return { status: 200, json: [] };
    });
  }

  it('未输入正确组织名前删除按钮保持禁用', async () => {
    mockOrgsApi();
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    const button = wrapper.find('[data-test="delete-org-button"]');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);

    const input = wrapper.find('[data-test="delete-confirm-input"]');
    (input.element as HTMLInputElement).value = 'wrong-org';
    await input.trigger('input');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);

    (input.element as HTMLInputElement).value = 'acme';
    await input.trigger('input');
    expect((button.element as HTMLButtonElement).disabled).toBe(false);
  });

  it('确认弹窗后才发起删除请求', async () => {
    const { requests } = mockOrgsApi();
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    const input = wrapper.find('[data-test="delete-confirm-input"]');
    (input.element as HTMLInputElement).value = 'acme';
    await input.trigger('input');
    await wrapper.find('[data-test="delete-org-button"]').trigger('click');
    await flushPromises();

    // 打开二次确认弹窗，尚未请求删除
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
    expect(wrapper.find('[data-test="delete-org-confirm"]').exists()).toBe(true);

    await wrapper.find('[data-test="delete-org-confirm"]').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'DELETE')).toBe(true);
    const deleteRequest = requests.find((request) => request.method === 'DELETE');
    expect(deleteRequest?.url).toBe('/api/admin/orgs/acme');
    expect(deleteRequest?.body).toEqual({ confirm: 'acme' });
  });
});

describe('SettingsView 平台设置', () => {
  function mockSettings(settings: Partial<Record<string, string>> = {}) {
    return useApiMock((method, url) => {
      if (url === '/api/admin/orgs/settings' && method === 'GET') {
        return {
          status: 200,
          json: {
            orgRegistrationMode: 'auto',
            registrationMode: 'open',
            memberAddMode: 'direct',
            ...settings
          }
        };
      }
      if (url === '/api/admin/orgs/settings' && method === 'PUT') {
        return {
          status: 200,
          json: {
            orgRegistrationMode: 'auto',
            registrationMode: 'open',
            memberAddMode: 'direct',
            ...settings
          }
        };
      }
      return { status: 200, json: [] };
    });
  }

  it('展示三项平台设置（用户注册 / 组织注册 / 拉人方式）', async () => {
    mockSettings();
    wrapper = await mountConsoleView(SettingsView, { account: 'platformAdmin', route: '/admin/super/settings' });
    await flushPromises();

    expect(wrapper.find('[data-test="user-registration-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="registration-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="member-add-mode"]').exists()).toBe(true);
    // 表单与已保存值一致时不出现保存变更
    expect((wrapper.find('[data-test="save-settings"]').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('切换注册模式后保存三项设置', async () => {
    const { requests } = mockSettings();
    wrapper = await mountConsoleView(SettingsView, { account: 'platformAdmin', route: '/admin/super/settings' });
    await flushPromises();

    const approvalRadio = wrapper
      .findAll('[data-test="user-registration-mode"] input[type="radio"]')
      .at(1)!;
    await approvalRadio.setValue(true);
    await flushPromises();

    await wrapper.find('[data-test="save-settings"]').trigger('click');
    await flushPromises();

    const put = requests.find((request) => request.method === 'PUT' && request.url === '/api/admin/orgs/settings');
    expect(put?.body).toMatchObject({ registrationMode: 'approval' });
  });
});

describe('DashboardView 平台概览', () => {
  it('汇总组织、待审批与技能数据', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs') {
        return {
          status: 200,
          json: [
            { name: 'acme', memberCount: 3, skillCount: 2, createdAt: '2026-08-01T10:00:00Z' },
            { name: 'beta', memberCount: 2, skillCount: 1 }
          ]
        };
      }
      if (url === '/api/admin/orgs/applications') {
        return { status: 200, json: applications };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(DashboardView, { account: 'platformAdmin', route: '/admin/super/dashboard' });
    await flushPromises();

    expect(wrapper.find('[data-test="stat-orgs"]').text()).toContain('2');
    expect(wrapper.find('[data-test="stat-pending"]').text()).toContain('1');
    expect(wrapper.find('[data-test="stat-skills"]').text()).toContain('3');
  });
});

// 平台管理员的组织身份兜底（ADR-0036）：超管不参与组织，不经成员身份也能查看、
// 变更身份与移除成员；"组织必须至少保留一名所有者成员"这条不变量对超管同样成立。
// 与组织侧的唯一差别是**空降**——组织里确实无人可用时，超管可以把组织外的人
// 直接设为所有者成员。
describe('超管组织成员兜底', () => {
  function mockAdminOrgsApi(members: Array<{ username: string; identity: string }>) {
    return useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') {
        return {
          status: 200,
          json: [{ name: 'acme', memberCount: members.length, skillCount: 0, createdAt: '2026-08-01T10:00:00Z', status: 'active', lastError: null }]
        };
      }
      if (url === '/api/admin/orgs/acme/members' && method === 'GET') {
        return { status: 200, json: members };
      }
      if (url === '/api/admin/orgs/acme/members/bob' && method === 'DELETE') {
        return { status: 200, json: { removed: true, orgName: 'acme', username: 'bob' } };
      }
      return { status: 200, json: [] };
    });
  }

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    await resetConsole();
  });

  it('展示组织成员与三档身份，并允许移除普通成员', async () => {
    const { requests } = mockAdminOrgsApi([
      { username: 'admin-alice', identity: 'owner' },
      { username: 'co-admin', identity: 'managing' },
      { username: 'bob', identity: 'ordinary' }
    ]);
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    const table = wrapper.find('[data-test="admin-members-table"]').text();
    expect(table).toContain('admin-alice');
    expect(table).toContain('bob');
    expect(wrapper.find('[data-test="admin-identity-owner"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="admin-identity-managing"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="admin-identity-ordinary"]').exists()).toBe(true);

    await wrapper.find('[data-test="admin-remove-bob"]').trigger('click');
    await flushPromises();

    expect(
      requests.some(
        (request) => request.method === 'DELETE' && request.url === '/api/admin/orgs/acme/members/bob'
      )
    ).toBe(true);
  });

  it('只剩一名所有者成员时禁止移除与收回', async () => {
    mockAdminOrgsApi([
      { username: 'admin-alice', identity: 'owner' },
      { username: 'bob', identity: 'ordinary' }
    ]);
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(
      (wrapper.find('[data-test="admin-remove-admin-alice"]').element as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (wrapper.find('[data-test="admin-demote-admin-alice"]').element as HTMLButtonElement).disabled
    ).toBe(true);
    expect((wrapper.find('[data-test="admin-remove-bob"]').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('超管可以空降：把组织外的人指派为所有者成员', async () => {
    const { requests } = mockAdminOrgsApi([{ username: 'admin-alice', identity: 'owner' }]);
    wrapper = await mountConsoleView(OrgDetailView, { account: 'platformAdmin', route: '/admin/super/orgs/acme' });
    await flushPromises();

    await wrapper.find('[data-test="admin-airdrop-open"]').trigger('click');
    await flushPromises();
    const input = wrapper.find('[data-test="admin-airdrop-username"]');
    (input.element as HTMLInputElement).value = 'outsider';
    await input.trigger('input');
    await wrapper.find('[data-test="admin-airdrop-submit"]').trigger('click');
    await flushPromises();

    const airdrop = requests.find(
      (request) => request.method === 'PUT' && request.url === '/api/admin/orgs/acme/members/outsider/identity'
    );
    expect(airdrop?.body).toEqual({ identity: 'owner' });
  });
});
