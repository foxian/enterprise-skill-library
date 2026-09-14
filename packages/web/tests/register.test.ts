import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import RegisterView from '../src/views/RegisterView.vue';
import { setFetchImpl } from '../src/api/client';

// 组织注册申请（ADR-0032）：申请人是已登录的 Skill User（用户名即管理员），
// 审批同步开通，无密码材料、无异步 Operation 流可订阅。
function mockFetch(status = 201, body: unknown = {}): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init ?? {} });
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

async function setField(wrapper: VueWrapper, testId: string, value: string): Promise<void> {
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

  it('提交组织名申请并展示待审批状态', async () => {
    const fetchMock = mockFetch(201, { status: 'pending', applicationId: 3, orgName: 'acme' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    const applyCall = fetchMock.calls.find((call) => call.url === '/api/orgs/applications');
    expect(applyCall).toBeDefined();
    expect(JSON.parse(String(applyCall!.init.body))).toEqual({ orgName: 'acme' });
    expect(wrapper.find('[data-test="register-result"]').text()).toContain('等待审批');
  });

  it('不合法组织名被拦截且不发起请求', async () => {
    const fetchMock = mockFetch(201, { status: 'pending' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'Bad Name');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="org-name-error"]').text()).toContain('lowercase');
    expect(fetchMock.calls.filter((call) => call.url === '/api/orgs/applications')).toHaveLength(0);
  });

  it('服务端拒绝时展示错误信息', async () => {
    setFetchImpl(mockFetch(409, { error: 'An application for this organization name is already pending' }).impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('already pending');
  });
});
