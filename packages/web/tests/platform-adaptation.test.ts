import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import LoginView from '../src/views/LoginView.vue';
import RegisterView from '../src/views/RegisterView.vue';
import { useApiMock } from './helpers';

// 按 URL 路由的 fetch mock：platform-info 与登录/注册端点返回各自响应
function routeMock(info: { mode: string; defaultOrg: string | null }) {
  return useApiMock((method, url, body) => {
    if (url === '/api/public/platform-info') return { status: 200, json: info };
    if (url === '/api/console/login') {
      return { status: 200, json: { token: 't', username: 'bob', org: 'acme', role: 'member' } };
    }
    if (url === '/api/orgs/apply') {
      return { status: 201, json: { status: 'pending', applicationId: 1 } };
    }
    return { status: 404, json: {} };
  });
}

async function setField(wrapper: VueWrapper, testId: string, value: string): Promise<void> {
  const input = wrapper.find(testId);
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
}

async function mountView(component: Component): Promise<VueWrapper> {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(component, {
    global: {
      plugins: [pinia, ElementPlus, router]
    }
  });
}

describe('web login and registration adapting to platform-info', () => {
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

  it('hides the organization input on the login page in single mode with a default org', async () => {
    const { requests } = routeMock({ mode: 'single', defaultOrg: 'acme' });
    wrapper = await mountView(LoginView);
    await flushPromises();

    expect(wrapper.find('[data-test="org"]').exists()).toBe(false);

    await setField(wrapper, '[data-test="username"]', 'bob');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await wrapper.find('[data-test="login-submit"]').trigger('submit');
    await flushPromises();

    const login = requests.find((request) => request.url === '/api/console/login');
    expect(login).toBeDefined();
    expect(login!.body).toMatchObject({ username: 'bob', org: null, password: 'secret' });
  });

  it('keeps the organization input visible in multi mode even when a default org is set', async () => {
    const { requests } = routeMock({ mode: 'multi', defaultOrg: 'acme' });
    wrapper = await mountView(LoginView);
    await flushPromises();

    // 多组织模式下默认组织只是留空的解析目标,其他组织用户仍需填写组织名
    expect(wrapper.find('[data-test="org"]').exists()).toBe(true);

    await setField(wrapper, '[data-test="username"]', 'bob');
    await setField(wrapper, '[data-test="org"]', 'beta');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await wrapper.find('[data-test="login-submit"]').trigger('submit');
    await flushPromises();

    const login = requests.find((request) => request.url === '/api/console/login');
    expect(login!.body).toMatchObject({ username: 'bob', org: 'beta', password: 'secret' });
  });

  it('hides the register entry on the login page in single mode', async () => {
    routeMock({ mode: 'single', defaultOrg: 'acme' });
    wrapper = await mountView(LoginView);
    await flushPromises();

    expect(wrapper.find('[data-test="register-link"]').exists()).toBe(false);
  });

  it('hides the application form and shows a notice on the register page in single mode', async () => {
    routeMock({ mode: 'single', defaultOrg: 'acme' });
    wrapper = await mountView(RegisterView);
    await flushPromises();

    expect(wrapper.find('[data-test="single-mode-notice"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="org-name"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="register-submit"]').exists()).toBe(false);
  });

  it('keeps the application form on the register page in multi mode', async () => {
    routeMock({ mode: 'multi', defaultOrg: null });
    wrapper = await mountView(RegisterView);
    await flushPromises();

    expect(wrapper.find('[data-test="single-mode-notice"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="org-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="register-submit"]').exists()).toBe(true);
  });
});
