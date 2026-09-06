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
// 挂载时会先请求 /api/public/platform-info 自适应交互,这里固定返回多组织无默认
// 组织,保持组织输入框可见,与既有用例的交互一致。
function mockFetch(status = 200, body: unknown = {}): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url);
    calls.push({ url: path, init: init ?? {} });
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
  values: { username: string; org?: string; password: string }
): Promise<void> {
  await setField(wrapper, '[data-test="username"]', values.username);
  if (values.org !== undefined) {
    await setField(wrapper, '[data-test="org"]', values.org);
  }
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

  it('走管理后台登录端点、发送组织与用户名并保存服务端返回的角色，跳转成员视图', async () => {
    const fetchMock = mockFetch(200, { token: 'member-token', username: 'bob', org: 'acme', role: 'member' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'bob', org: 'acme', password: 'secret' });

    const loginCall = fetchMock.calls.find((call) => call.url === '/api/console/login');
    expect(loginCall).toBeDefined();
    expect(JSON.parse(String(loginCall!.init.body))).toEqual({
      username: 'bob',
      org: 'acme',
      password: 'secret'
    });

    const auth = useAuthStore();
    expect(auth.token).toBe('member-token');
    expect(auth.role).toBe('member');
    expect(auth.org).toBe('acme');
    const stored = JSON.parse(localStorage.getItem('esl-admin-session') ?? '{}');
    expect(stored).toMatchObject({ token: 'member-token', username: 'bob', org: 'acme', role: 'member' });
    expect(router.push).toHaveBeenCalledWith('/admin/member/skills');
  });

  it('用户名为 admin 的组织账号登录后跳转组织管理视图', async () => {
    setFetchImpl(
      mockFetch(200, { token: 'org-admin-token', username: 'admin', org: 'acme', role: 'org-admin' }).impl
    );
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'admin', org: 'acme', password: 'secret' });

    const auth = useAuthStore();
    expect(auth.role).toBe('org-admin');
    expect(router.push).toHaveBeenCalledWith('/admin/org/members');
  });

  it('组织名留空时按超级管理员登录并跳转超管视图', async () => {
    const fetchMock = mockFetch(200, { token: 'super-token', username: 'eslroot', org: null, role: 'super' });
    setFetchImpl(fetchMock.impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'eslroot', org: '', password: 'secret' });

    const loginCall = fetchMock?.calls.find((call) => call.url === '/api/console/login');
    expect(JSON.parse(String(loginCall?.init.body ?? '{}'))).toEqual({
      username: 'eslroot',
      org: null,
      password: 'secret'
    });

    const auth = useAuthStore();
    expect(auth.role).toBe('super');
    expect(auth.org).toBeNull();
    expect(router.push).toHaveBeenCalledWith('/admin/super/dashboard');
  });

  it('登录失败时展示错误信息且不写入会话', async () => {
    setFetchImpl(mockFetch(401, { error: 'Unauthorized: invalid credentials' }).impl);
    wrapper = await mountLogin();

    await fillAndSubmit(wrapper, { username: 'bob', org: 'acme', password: 'wrong' });

    expect(wrapper.find('[data-test="login-error"]').text()).toContain('invalid credentials');
    expect(useAuthStore().isLoggedIn).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});
