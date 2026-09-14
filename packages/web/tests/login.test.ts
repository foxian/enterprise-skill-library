import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import LoginView from '../src/views/LoginView.vue';
import { setFetchImpl } from '../src/api/client';
import { useAuthStore } from '../src/stores/auth';

// 登录视图的响应式 fetch mock：记录请求体并返回可配置的响应。
// 挂载时会先请求 /api/public/platform-info 自适应交互。
function mockFetch(status = 200, body: unknown = {}): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init ?? {} });
    if (path === '/api/public/platform-info') {
      return new Response(
        JSON.stringify({ registrationMode: 'open', memberAddMode: 'direct', orgRegistrationMode: 'auto' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
  return { impl, calls };
}

async function mountLogin(): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(LoginView as unknown as Component, {
    global: {
      plugins: [pinia, ElementPlus, router]
    }
  });
}

async function fillAndSubmit(
  wrapper: VueWrapper,
  values: { username: string; password: string }
): Promise<void> {
  await setField(wrapper, '[data-test="username"]', values.username);
  await setField(wrapper, '[data-test="password"]', values.password);
  await wrapper.find('[data-test="login-submit"]').trigger('submit');
  await flushPromises();
}

async function setField(wrapper: VueWrapper, testId: string, value: string): Promise<void> {
  // Element Plus 会把透传属性（如 data-test）落到内部 input 元素上
  const input = wrapper.find(testId);
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
}

// 全局身份登录（ADR-0032 / ADR-0033）：不再有组织输入；服务端只回"是不是平台
// 管理员"与"在每个组织是不是组织管理团队成员"，前端不推导角色、不挑当前组织。
describe('LoginView', () => {
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

  it('校验必填项，用户名或密码为空时不发起请求', async () => {
    wrapper = await mountLogin();
    await fillAndSubmit(wrapper, { username: '', password: '' });

    expect(wrapper.find('[data-test="login-error"]').text()).toContain('请输入用户名与密码');
    expect(localStorage.getItem('esl-admin-session')).toBeNull();
  });

  it('登录页没有组织输入，只提交用户名与密码', async () => {
    wrapper = await mountLogin();

    expect(wrapper.find('[data-test="org"]').exists()).toBe(false);

    const fetchMock = mockFetch(200, {
      token: 'member-token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', isOrgManager: false }]
    });
    setFetchImpl(fetchMock.impl);
    await fillAndSubmit(wrapper, { username: 'bob', password: 'secret' });

    const loginCall = fetchMock.calls.find((call) => call.url === '/api/console/login');
    expect(loginCall).toBeDefined();
    expect(JSON.parse(String(loginCall!.init.body))).toEqual({
      username: 'bob',
      password: 'secret'
    });
  });

  it('保存服务端返回的平台身份与逐组织治理权，跳转个人控制台', async () => {
    const fetchMock = mockFetch(200, {
      token: 'member-token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', isOrgManager: false }]
    });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'bob', password: 'secret' });

    const auth = useAuthStore();
    expect(auth.token).toBe('member-token');
    expect(auth.isPlatformAdmin).toBe(false);
    expect(auth.organizations).toEqual([{ org: 'acme', isOrgManager: false }]);
    const stored = JSON.parse(localStorage.getItem('esl-admin-session') ?? '{}');
    expect(stored).toMatchObject({
      token: 'member-token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [{ org: 'acme', isOrgManager: false }]
    });
    expect(router.push).toHaveBeenCalledWith('/admin/me/overview');
  });

  it('组织管理团队成员登录后仍落个人控制台——治理权是逐组织的，不是全局视角', async () => {
    setFetchImpl(
      mockFetch(200, {
        token: 'org-manager-token',
        username: 'alice',
        isPlatformAdmin: false,
        organizations: [
          { org: 'acme', isOrgManager: false },
          { org: 'beta', isOrgManager: true }
        ]
      }).impl
    );
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'alice', password: 'secret' });

    const auth = useAuthStore();
    expect(auth.organizations).toEqual([
      { org: 'acme', isOrgManager: false },
      { org: 'beta', isOrgManager: true }
    ]);
    // 不挑"第一个可治理的组织"当上下文——那是被 ADR-0035 消灭的隐式组织
    expect(router.push).toHaveBeenCalledWith('/admin/me/overview');
  });

  it('超级管理员登录（无组织隶属）跳转超管视图', async () => {
    const fetchMock = mockFetch(200, {
      token: 'super-token',
      username: 'eslroot',
      isPlatformAdmin: true,
      organizations: []
    });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'eslroot', password: 'secret' });

    const auth = useAuthStore();
    expect(auth.isPlatformAdmin).toBe(true);
    expect(auth.organizations).toEqual([]);
    expect(router.push).toHaveBeenCalledWith('/admin/super/dashboard');
  });

  it('登录失败时展示错误信息且不写入会话', async () => {
    setFetchImpl(mockFetch(401, { error: 'Unauthorized: invalid credentials' }).impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'bob', password: 'wrong' });

    expect(wrapper.find('[data-test="login-error"]').text()).toContain('invalid credentials');
    expect(useAuthStore().isLoggedIn).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});
