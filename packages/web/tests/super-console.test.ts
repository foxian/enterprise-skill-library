import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { router } from '../src/router';
import ApplicationsView from '../src/views/super/ApplicationsView.vue';
import OrgDetailView from '../src/views/super/OrgDetailView.vue';
import OrgsView from '../src/views/super/OrgsView.vue';
import SettingsView from '../src/views/super/SettingsView.vue';
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
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
    await flushPromises();

    expect(wrapper.find('[data-test="applications-table"]').text()).toContain('alpha');
    expect(wrapper.find('[data-test="applications-table"]').text()).not.toContain('beta');
  });

  it('批准申请后展示一次性初始密码并刷新列表', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/orgs/applications' && method === 'GET') {
        return { status: 200, json: applications };
      }
      if (url === '/api/admin/orgs/applications/1/approve') {
        return { status: 200, json: { status: 'approved', orgName: 'alpha', initialPassword: 'one-time-pass' } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
    await flushPromises();

    await wrapper.find('[data-test="approve-1"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/orgs/applications/1/approve'
    );
    expect(wrapper.find('[data-test="initial-password"]').exists()).toBe(true);
    const passwordInput = wrapper.find('[data-test="initial-password"]').element as HTMLInputElement;
    expect(passwordInput.value).toBe('one-time-pass');
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
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
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
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
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
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
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
    wrapper = await mountConsoleView(ApplicationsView, { role: 'super', route: '/admin/super/applications' });
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

describe('OrgsView 组织生命周期状态展示', () => {
  const lifecycleOrgs = [
    { name: 'alpha', memberCount: 1, skillCount: 0, status: 'provisioning', lastError: null, operationId: 11 },
    { name: 'beta', memberCount: 2, skillCount: 1, status: 'active', lastError: null, operationId: null },
    { name: 'gamma', memberCount: 2, skillCount: 1, status: 'failed', lastError: { code: 'PROVISIONING_FAILED', message: 'password too short', details: {} }, operationId: 12 },
    { name: 'delta', memberCount: 3, skillCount: 2, status: 'deleting', lastError: null, operationId: 13 },
    { name: 'omega', memberCount: 3, skillCount: 2, status: 'delete_failed', lastError: { code: 'EXTERNAL_RESOURCE', message: 'external repo found', details: { resources: ['repository acme/outsider'] } }, operationId: 14 }
  ];

  it('区分展示开通中、已激活、失败、删除中与删除失败状态', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs') {
        return { status: 200, json: lifecycleOrgs };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgsView, { role: 'super', route: '/admin/super/orgs' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-status-alpha"]').text()).toContain('开通中');
    expect(wrapper.find('[data-test="org-status-beta"]').text()).toContain('已激活');
    expect(wrapper.find('[data-test="org-status-gamma"]').text()).toContain('开通失败');
    expect(wrapper.find('[data-test="org-status-delta"]').text()).toContain('删除中');
    expect(wrapper.find('[data-test="org-status-omega"]').text()).toContain('删除失败');
  });

  it('开通组织：等待激活成功后关闭对话框并展示一次性密码', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') {
        return { status: 200, json: [{ name: 'acme', memberCount: 1, skillCount: 0, status: 'active' }] };
      }
      if (url === '/api/admin/orgs' && method === 'POST') {
        return {
          status: 202,
          json: { status: 'provisioning', orgName: 'neworg', operationId: 99, initialPassword: 'generated-password-123' }
        };
      }
      return { status: 200, json: [] };
    });

    // 激活成功：订阅建立后立即推送 succeeded
    vi.mocked(clientApi.openOperationStream).mockImplementation((_id, options) => {
      options.onEvent({ operationId: 99, status: 'succeeded', error: null });
      return { close: vi.fn() };
    });

    wrapper = await mountConsoleView(OrgsView, { role: 'super', route: '/admin/super/orgs' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-org"]').trigger('click');
    await flushPromises();

    const nameInput = document.querySelector('[data-test="add-org-name"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    nameInput.value = 'neworg';
    await nameInput.dispatchEvent(new Event('input'));
    await flushPromises();

    (document.querySelector('[data-test="add-org-submit"]') as HTMLButtonElement).click();
    await flushPromises();

    const postReq = requests.find((r) => r.method === 'POST' && r.url === '/api/admin/orgs');
    expect(postReq?.body).toEqual({ orgName: 'neworg', password: undefined });

    // 激活成功后：开通对话框关闭、一次性密码展示
    const vm = wrapper.vm as unknown as {
      provisioning: boolean;
      addDialogVisible: boolean;
      passwordDialogVisible: boolean;
      orgs: Array<{ name: string }>;
    };
    expect(vm.provisioning).toBe(false);
    expect(vm.addDialogVisible).toBe(false);
    expect(vm.passwordDialogVisible).toBe(true);

    const passwordInput = document.querySelector('[data-test="one-time-password"]') as HTMLInputElement;
    expect(passwordInput).not.toBeNull();
    expect(passwordInput.value).toBe('generated-password-123');

    // 列表已刷新
    expect(vm.orgs.some((org) => org.name === 'acme')).toBe(true);
  });

  it('开通组织：激活失败时留在对话框并显示错误，可重新提交', async () => {
    useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') return { status: 200, json: [] };
      if (url === '/api/admin/orgs' && method === 'POST') {
        return {
          status: 202,
          json: { status: 'provisioning', orgName: 'neworg', operationId: 99, initialPassword: 'pw-123' }
        };
      }
      return { status: 200, json: [] };
    });

    vi.mocked(clientApi.openOperationStream).mockImplementation((_id, options) => {
      options.onEvent({ operationId: 99, status: 'permanently_failed', error: 'provisioning failed' });
      return { close: vi.fn() };
    });

    wrapper = await mountConsoleView(OrgsView, { role: 'super', route: '/admin/super/orgs' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-org"]').trigger('click');
    await flushPromises();

    const nameInput = document.querySelector('[data-test="add-org-name"]') as HTMLInputElement;
    nameInput.value = 'neworg';
    await nameInput.dispatchEvent(new Event('input'));
    await flushPromises();

    (document.querySelector('[data-test="add-org-submit"]') as HTMLButtonElement).click();
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      provisioning: boolean;
      addDialogVisible: boolean;
      provisioningError: string;
      passwordDialogVisible: boolean;
      addOrgName: string;
    };
    // 失败后对话框保持打开、表单恢复可编辑、显示错误
    expect(vm.provisioning).toBe(false);
    expect(vm.addDialogVisible).toBe(true);
    expect(vm.provisioningError).toContain('开通失败');
    // 不弹密码
    expect(vm.passwordDialogVisible).toBe(false);
    // 表单字段保留,可直接重试
    expect(vm.addOrgName).toBe('neworg');
  });

  it('开通组织：组织管理员账号随组织名自动生成且不可编辑', async () => {
    useApiMock((_method, url) => {
      if (url === '/api/admin/orgs' && _method === 'GET') return { status: 200, json: [] };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgsView, { role: 'super', route: '/admin/super/orgs' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-org"]').trigger('click');
    await flushPromises();

    const adminInput = document.querySelector('[data-test="add-org-admin-username"]') as HTMLInputElement;
    expect(adminInput).not.toBeNull();
    expect(adminInput.value).toBe('');

    const nameInput = document.querySelector('[data-test="add-org-name"]') as HTMLInputElement;
    nameInput.value = 'neworg';
    await nameInput.dispatchEvent(new Event('input'));
    await flushPromises();

    expect(adminInput.value).toBe('neworg_admin');
    expect(adminInput.readOnly).toBe(true);
  });

  it('开通组织：非法组织名被前端校验拦截', async () => {
    const { requests } = useApiMock((_method, url) => {
      if (url === '/api/admin/orgs' && _method === 'GET') return { status: 200, json: [] };
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OrgsView, { role: 'super', route: '/admin/super/orgs' });
    await flushPromises();

    await wrapper.find('[data-test="open-add-org"]').trigger('click');
    await flushPromises();

    const nameInput = document.querySelector('[data-test="add-org-name"]') as HTMLInputElement;
    nameInput.value = 'UPPER-CASE';
    await nameInput.dispatchEvent(new Event('input'));
    await flushPromises();

    (document.querySelector('[data-test="add-org-submit"]') as HTMLButtonElement).click();
    await flushPromises();

    // 没有发出 POST 请求
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/admin/orgs')).toBe(false);
  });
});

describe('OrgDetailView 组织详情', () => {
  const orgs = [{ name: 'acme', memberCount: 3, skillCount: 2, createdAt: '2026-08-01T10:00:00Z' }];

  function mockOrgsApi(extra: Record<string, unknown> = {}) {
    return useApiMock((method, url) => {
      if (url === '/api/admin/orgs' && method === 'GET') {
        return { status: 200, json: orgs.map((org) => ({ ...org, status: null, lastError: null, operationId: null, ...extra })) };
      }
      if (url === '/api/admin/orgs/acme' && method === 'DELETE') {
        return { status: 200, json: { deleted: true, orgName: 'acme' } };
      }
      return { status: 200, json: [] };
    });
  }

  it('开通失败的组织展示失败原因与重试入口', async () => {
    const { requests } = mockOrgsApi({
      status: 'failed',
      operationId: 12,
      lastError: { code: 'PROVISIONING_FAILED', message: 'password too short', details: {} }
    });
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').text()).toContain('password too short');
    expect(wrapper.find('[data-test="retry-operation"]').exists()).toBe(true);

    requests.length = 0;
    await wrapper.find('[data-test="retry-operation"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/operations/12/retry'
    );
  });

  it('删除失败的组织展示失败原因与重试入口', async () => {
    const { requests } = mockOrgsApi({
      status: 'delete_failed',
      operationId: 14,
      lastError: { code: 'EXTERNAL_RESOURCE', message: 'external repo found', details: {} }
    });
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').text()).toContain('external repo found');
    expect(wrapper.find('[data-test="retry-operation"]').exists()).toBe(true);

    requests.length = 0;
    await wrapper.find('[data-test="retry-operation"]').trigger('click');
    await flushPromises();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toContain(
      'POST /api/admin/operations/14/retry'
    );
  });

  it('激活状态的组织不展示失败原因与重试入口', async () => {
    mockOrgsApi({ status: 'active', operationId: null, lastError: null });
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="retry-operation"]').exists()).toBe(false);
  });

  it('失败但无关联 Operation 的组织不展示重试入口(无重试目标)', async () => {
    mockOrgsApi({ status: 'failed', operationId: null, lastError: { code: 'OPERATION_FAILED', message: 'boom', details: {} } });
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
    await flushPromises();

    expect(wrapper.find('[data-test="org-last-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="retry-operation"]').exists()).toBe(false);
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
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
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
    wrapper = await mountConsoleView(OrgDetailView, { role: 'super', route: '/admin/super/orgs/acme' });
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
  const sampleOrgs = [
    { name: 'acme', memberCount: 3, skillCount: 2, status: 'active', createdAt: '2026-08-01T10:00:00Z' },
    { name: 'beta', memberCount: 2, skillCount: 1, status: 'active', createdAt: '2026-08-02T10:00:00Z' },
    { name: 'gamma', memberCount: 1, skillCount: 0, status: 'pending', createdAt: '2026-08-03T10:00:00Z' },
  ];

  function mockSettingsApi(initial: {
    orgRegistrationMode?: string;
    deploymentMode?: string;
    defaultOrg?: string | null;
  } = {}) {
    const defaults = {
      orgRegistrationMode: 'auto',
      deploymentMode: 'multi',
      defaultOrg: null,
      ...initial,
    };
    return useApiMock((method, url, body) => {
      if (url === '/api/admin/orgs/settings') {
        if (method === 'PUT') {
          const merged = { ...defaults, ...(body as Record<string, unknown>) };
          return { status: 200, json: merged };
        }
        return { status: 200, json: defaults };
      }
      if (url === '/api/admin/orgs') {
        return { status: 200, json: sampleOrgs };
      }
      return { status: 200, json: [] };
    });
  }

  it('加载当前审批模式并保存切换', async () => {
    const { requests } = mockSettingsApi();
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const manualRadio = wrapper.find('[data-test="registration-mode"] input[value="manual"]');
    (manualRadio.element as HTMLInputElement).checked = true;
    await manualRadio.trigger('change');
    await wrapper.find('[data-test="save-settings"]').trigger('click');
    await flushPromises();

    expect(requests.some((request) => request.method === 'PUT')).toBe(true);
    const putReq = requests.find((request) => request.method === 'PUT');
    expect(putReq?.body).toMatchObject({ orgRegistrationMode: 'manual' });
    // 保存后按钮回到禁用（无未保存修改）
    expect((wrapper.find('[data-test="save-settings"]').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('加载部署模式和默认组织，默认组织下拉仅展示 active 组织', async () => {
    mockSettingsApi({ deploymentMode: 'multi', defaultOrg: 'acme' });
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const select = wrapper.find('[data-test="default-org-select"]');
    expect(select.exists()).toBe(true);
    // 通过 vm 直接访问 activeOrgs 计算属性，验证只有 active 的组织被过滤出来
    const vm = wrapper.vm as unknown as { activeOrgs: Array<{ name: string; status: string }> };
    expect(vm.activeOrgs.map((o) => o.name)).toEqual(['acme', 'beta']);
    expect(vm.activeOrgs.map((o) => o.name)).not.toContain('gamma');
  });

  it('从多组织切换到单组织并选择默认组织（原子切换，无需确认）', async () => {
    const { requests } = mockSettingsApi({ deploymentMode: 'multi', defaultOrg: null });
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      deploymentMode: string;
      defaultOrg: string;
      hasChanges: boolean;
      hasValidationError: boolean;
    };

    // 切换部署模式为单组织
    vm.deploymentMode = 'single';
    await flushPromises();

    // 未选默认组织时有校验错误（按钮禁用）
    expect(vm.hasValidationError).toBe(true);
    expect((wrapper.find('[data-test="save-settings"]').element as HTMLButtonElement).disabled).toBe(true);

    // 选择默认组织 beta
    vm.defaultOrg = 'beta';
    await flushPromises();

    expect(vm.hasChanges).toBe(true);
    expect(vm.hasValidationError).toBe(false);
    expect((wrapper.find('[data-test="save-settings"]').element as HTMLButtonElement).disabled).toBe(false);

    await wrapper.find('[data-test="save-settings"]').trigger('click');
    await flushPromises();

    // 确认对话框不应出现（原子切换不需要 confirm）
    expect(wrapper.find('[data-test="confirm-default-org-dialog"]').exists()).toBe(false);

    const putReq = requests.find((r) => r.method === 'PUT');
    expect(putReq?.body).toMatchObject({
      deploymentMode: 'single',
      defaultOrg: 'beta',
    });
    expect(putReq?.body).not.toHaveProperty('confirm');
  });

  it('单组织模式下更换默认组织弹出确认对话框，输入匹配后提交', async () => {
    const { requests } = mockSettingsApi({ deploymentMode: 'single', defaultOrg: 'acme' });
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      defaultOrg: string;
      confirmInput: string;
      needsConfirm: boolean;
    };

    // 将默认组织从 acme 改为 beta
    vm.defaultOrg = 'beta';
    await flushPromises();

    expect(vm.needsConfirm).toBe(true);

    await wrapper.find('[data-test="save-settings"]').trigger('click');
    await flushPromises();

    // 弹出确认对话框
    const dialog = wrapper.find('[data-test="confirm-default-org-dialog"]');
    expect(dialog.exists()).toBe(true);

    // 输入不匹配时按钮禁用
    const input = wrapper.find('[data-test="confirm-default-org-input"]');
    await input.setValue('wrong-name');
    await flushPromises();
    expect(
      (wrapper.find('[data-test="confirm-default-org-button"]').element as HTMLButtonElement).disabled
    ).toBe(true);

    // 输入匹配后可点击
    await input.setValue('beta');
    await flushPromises();
    expect(
      (wrapper.find('[data-test="confirm-default-org-button"]').element as HTMLButtonElement).disabled
    ).toBe(false);

    await wrapper.find('[data-test="confirm-default-org-button"]').trigger('click');
    await flushPromises();

    const putReq = requests.find((r) => r.method === 'PUT');
    expect(putReq?.body).toMatchObject({
      deploymentMode: 'single',
      defaultOrg: 'beta',
      confirm: 'beta',
    });
    // 保存后对话框关闭
    const vm2 = wrapper.vm as unknown as { confirmDialogVisible: boolean };
    expect(vm2.confirmDialogVisible).toBe(false);
  });

  it('多组织模式下默认组织可清空（clearable=true）', async () => {
    mockSettingsApi({ deploymentMode: 'multi', defaultOrg: 'acme' });
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const vm = wrapper.vm as unknown as { deploymentMode: string };
    expect(vm.deploymentMode).toBe('multi');
    // el-select 的 clearable 属性通过 DOM 类名不好直接断言，
    // 用 vm 状态和组件属性验证：多组织模式下应该可清空
    const selectComp = wrapper.findComponent({ name: 'ElSelect' });
    expect(selectComp.props('clearable')).toBe(true);
  });

  it('单组织模式下默认组织不可清空（clearable=false）', async () => {
    mockSettingsApi({ deploymentMode: 'single', defaultOrg: 'acme' });
    wrapper = await mountConsoleView(SettingsView, { role: 'super', route: '/admin/super/settings' });
    await flushPromises();

    const vm = wrapper.vm as unknown as { deploymentMode: string };
    expect(vm.deploymentMode).toBe('single');
    const selectComp = wrapper.findComponent({ name: 'ElSelect' });
    expect(selectComp.props('clearable')).toBe(false);
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
    wrapper = await mountConsoleView(DashboardView, { role: 'super', route: '/admin/super/dashboard' });
    await flushPromises();

    expect(wrapper.find('[data-test="stat-orgs"]').text()).toContain('2');
    expect(wrapper.find('[data-test="stat-pending"]').text()).toContain('1');
    expect(wrapper.find('[data-test="stat-skills"]').text()).toContain('3');
  });
});
