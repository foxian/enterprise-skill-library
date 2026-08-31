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
    calls.push({ url: String(url), init: init ?? {} });
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
    await setField(wrapper, '[data-test="admin-display-name"]', 'Alice');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await setField(wrapper, '[data-test="confirm-password"]', 'different');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('两次输入的密码不一致');
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('提交申请并展示待审批状态', async () => {
    const fetchMock = mockFetch(201, { status: 'pending', applicationId: 3 });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="admin-display-name"]', 'Alice');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await setField(wrapper, '[data-test="confirm-password"]', 'secret');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();
    await vi.waitFor(() => expect(fetchMock.calls).toHaveLength(1));

    expect(fetchMock.calls[0].url).toBe('/api/orgs/apply');
    expect(JSON.parse(String(fetchMock.calls[0].init.body))).toEqual({
      orgName: 'acme',
      adminDisplayName: 'Alice',
      password: 'secret'
    });
    expect(wrapper.find('[data-test="register-result"]').text()).toContain('等待审批');
  });

  it('免审批模式下直接展示已开通状态', async () => {
    setFetchImpl(mockFetch(201, { status: 'approved' }).impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="admin-display-name"]', 'Alice');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await setField(wrapper, '[data-test="confirm-password"]', 'secret');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-result"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="register-result"]').text()).toContain('组织已开通');
  });

  it('重名申请被拒绝时展示服务端错误', async () => {
    setFetchImpl(mockFetch(409, { error: 'Organization name is already taken' }).impl);
    wrapper = await mountRegister();

    await setField(wrapper, '[data-test="org-name"]', 'acme');
    await setField(wrapper, '[data-test="admin-display-name"]', 'Alice');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await setField(wrapper, '[data-test="confirm-password"]', 'secret');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('already taken');
    expect(wrapper.find('[data-test="register-result"]').exists()).toBe(false);
  });
});
