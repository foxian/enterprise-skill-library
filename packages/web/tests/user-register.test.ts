import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import UserRegisterView from '../src/views/UserRegisterView.vue';
import { setFetchImpl } from '../src/api/client';

// 用户自助注册页（ADR-0032 / #52）：open 注册即用，approval 展示待审批状态。
function mockFetch(platformInfo: { registrationMode: 'open' | 'approval' }, registerStatus: number, registerBody: unknown): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init ?? {} });
    if (path === '/api/public/platform-info') {
      return new Response(JSON.stringify({ mode: 'multi', defaultOrg: null, ...platformInfo }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify(registerBody), {
      status: registerStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  return { impl, calls };
}

async function mountUserRegister(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(UserRegisterView as unknown as Component, {
    global: {
      plugins: [pinia, ElementPlus, router]
    }
  });
}

async function setField(wrapper: VueWrapper, testId: string, value: string): Promise<void> {
  const input = wrapper.find(testId);
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
}

describe('UserRegisterView', () => {
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

  it('open 模式：注册成功并提示前往登录', async () => {
    const fetchMock = mockFetch({ registrationMode: 'open' }, 201, { status: 'registered', username: 'dave' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountUserRegister();
    await flushPromises();

    await setField(wrapper, '[data-test="register-username"]', 'dave');
    await setField(wrapper, '[data-test="register-password"]', 'a-valid-password');
    await setField(wrapper, '[data-test="register-confirm"]', 'a-valid-password');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    const call = fetchMock.calls.find((candidate) => candidate.url === '/api/auth/register');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call!.init.body))).toEqual({ username: 'dave', password: 'a-valid-password' });
    expect(wrapper.find('[data-test="register-success"]').text()).toContain('dave');
  });

  it('approval 模式：注册后展示待审批状态', async () => {
    const fetchMock = mockFetch(
      { registrationMode: 'approval' },
      202,
      { status: 'pending', username: 'erin', registrationId: 7 }
    );
    setFetchImpl(fetchMock.impl);
    wrapper = await mountUserRegister();
    await flushPromises();

    await setField(wrapper, '[data-test="register-username"]', 'erin');
    await setField(wrapper, '[data-test="register-password"]', 'a-valid-password');
    await setField(wrapper, '[data-test="register-confirm"]', 'a-valid-password');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-pending"]').text()).toContain('审批');
  });

  it('提交时两次输入的密码不一致被拦截', async () => {
    const fetchMock = mockFetch({ registrationMode: 'open' }, 201, { status: 'registered', username: 'dave' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountUserRegister();
    await flushPromises();

    await setField(wrapper, '[data-test="register-username"]', 'dave');
    await setField(wrapper, '[data-test="register-password"]', 'a-valid-password');
    await setField(wrapper, '[data-test="register-confirm"]', 'different-pass');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('两次输入的密码不一致');
    expect(fetchMock.calls.filter((candidate) => candidate.url === '/api/auth/register')).toHaveLength(0);
  });

  it('服务端拒绝（用户名被占用）时展示错误', async () => {
    const fetchMock = mockFetch({ registrationMode: 'open' }, 409, { error: 'Username is already taken: dave' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountUserRegister();
    await flushPromises();

    await setField(wrapper, '[data-test="register-username"]', 'dave');
    await setField(wrapper, '[data-test="register-password"]', 'a-valid-password');
    await setField(wrapper, '[data-test="register-confirm"]', 'a-valid-password');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('already taken');
  });
});
