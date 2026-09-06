import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import RegisterView from '../src/views/RegisterView.vue';
import { setFetchImpl } from '../src/api/client';

function mockFetch(status = 201, body: unknown = {}): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init ?? {} });
    // 挂载时先请求平台信息自适应交互:返回多组织模式,保持注册表单可见。
    if (path === '/api/public/platform-info') {
      return new Response(JSON.stringify({ mode: 'multi', defaultOrg: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  return { impl, calls };
}

async function mountRegister(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(RegisterView as unknown as Component, {
    global: {
      plugins: [pinia, ElementPlus, router]
    }
  });
}

async function setField(
  wrapper: VueWrapper,
  testId: string,
  value: string
): Promise<void> {
  // Element Plus 会把透传属性（如 data-test）落到内部 input 元素上
  const input = wrapper.find(testId);
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
}

describe('RegisterView', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(router, 'push').mockImplementation(async () => undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    wrapper = undefined;
  });

  it('实时校验组织命名规则，非法组织名给出提示', async () => {
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'Bad_Org');

    expect(wrapper.find('[data-test="org-name-error"]').text()).toContain('lowercase letters');
  });

  it('保留字组织名被拒绝', async () => {
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'admin');

    expect(wrapper.find('[data-test="org-name-error"]').text()).toContain('reserved');
  });

  it('合法组织名不显示错误提示', async () => {
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');

    expect(wrapper.find('[data-test="org-name-error"]').exists()).toBe(false);
  });

  it('两次密码不一致时拒绝提交', async () => {
    const fetchMock = mockFetch(201, { status: 'pending' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'different-password');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('两次输入的密码不一致');
    expect(fetchMock.calls.filter((call) => call.url === '/api/orgs/apply')).toHaveLength(0);
  });

  it('低于密码策略最小长度的密码被拒绝提交', async () => {
    const fetchMock = mockFetch(201, { status: 'pending' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'short-pass');
    await setField(wrapper, '[data-test="confirm-password"]', 'short-pass');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('password must be at least');
    expect(fetchMock.calls.filter((call) => call.url === '/api/orgs/apply')).toHaveLength(0);
  });

  it('提交申请并展示待审批状态', async () => {
    const fetchMock = mockFetch(201, { status: 'pending', applicationId: 3 });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'initial-password-123');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();
    await vi.waitFor(() =>
      expect(fetchMock.calls.filter((call) => call.url === '/api/orgs/apply')).toHaveLength(1)
    );

    const applyCall = fetchMock.calls.find((call) => call.url === '/api/orgs/apply');
    expect(JSON.parse(String(applyCall!.init.body))).toEqual({
      orgName: 'acme',
      adminDisplayName: 'admin',
      password: 'initial-password-123'
    });
    expect(wrapper.find('[data-test="register-result"]').text()).toContain('等待审批');
  });

  // 构造一个带 SSE 事件的流式 Response,供 openOperationStream 消费
  function sseResponse(events: unknown[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      }
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  }

  it('auto 模式提交后自动订阅开通流，开通成功时界面自动更新为已开通', async () => {
    setFetchImpl((async (url: string | URL) => {
      const path = String(url);
      if (path === '/api/orgs/apply') {
        return new Response(JSON.stringify({ status: 'provisioning', operationId: 5 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/operations/5/stream') {
        return sseResponse([
          { operationId: 5, status: 'pending', error: null },
          { operationId: 5, status: 'succeeded', error: null }
        ]);
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'initial-password-123');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper!.find('[data-test="register-result"]').text()).toContain('组织已开通');
    });
  });

  it('auto 模式开通失败时界面自动展示失败状态', async () => {
    setFetchImpl((async (url: string | URL) => {
      const path = String(url);
      if (path === '/api/orgs/apply') {
        return new Response(JSON.stringify({ status: 'provisioning', operationId: 6 }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (path === '/api/operations/6/stream') {
        return sseResponse([{ operationId: 6, status: 'permanently_failed', error: 'simulated failure' }]);
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'initial-password-123');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper!.find('[data-test="register-result"]').text()).toContain('组织开通失败');
    });
  });

  it('免审批模式下直接展示已开通状态', async () => {
    setFetchImpl(mockFetch(201, { status: 'approved' }).impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'initial-password-123');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-result"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="register-result"]').text()).toContain('组织已开通');
  });

  it('管理员账号只读默认 admin，并预览组装后的登录账号', async () => {
    wrapper = await mountRegister();

    const accountInput = wrapper.find('[data-test="admin-account"]').element as HTMLInputElement;
    expect(accountInput.value).toBe('admin');
    expect(accountInput.disabled).toBe(true);
    expect(wrapper.find('[data-test="admin-account-preview"]').text()).toContain('组织名_admin');

    await setField(wrapper, '[data-test="org-name"]', 'acme');

    expect(wrapper.find('[data-test="admin-account-preview"]').text()).toContain('acme_admin');
  });

  it('重名申请被拒绝时展示服务端错误', async () => {
    setFetchImpl(mockFetch(409, { error: 'Organization name is already taken' }).impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="password"]', 'initial-password-123');
    await setField(wrapper, '[data-test="confirm-password"]', 'initial-password-123');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('already taken');
    expect(wrapper.find('[data-test="register-result"]').exists()).toBe(false);
  });

  it('申请人可按组织名与申请密码查询申请状态', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    setFetchImpl((async (url: string | URL, init?: RequestInit) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url) === '/api/orgs/applications/acme/status') {
        return new Response(JSON.stringify({ orgName: 'acme', status: 'provisioning' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Organization application not found' }), { status: 404 });
    }) as typeof fetch);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="status-org-name"]', 'acme');
    await setField(wrapper, '[data-test="status-password"]', 'initial-password-123');
    await wrapper.find('[data-test="status-query"]').trigger('click');
    await flushPromises();

    const statusCall = calls.find((call) => call.url === '/api/orgs/applications/acme/status');
    expect(statusCall?.body).toEqual({ password: 'initial-password-123' });
    expect(wrapper.find('[data-test="status-result"]').text()).toContain('开通中');

    await setField(wrapper, '[data-test="status-org-name"]', 'ghost');
    await wrapper.find('[data-test="status-query"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="status-result"]').text()).toContain('未找到');
  });
});
