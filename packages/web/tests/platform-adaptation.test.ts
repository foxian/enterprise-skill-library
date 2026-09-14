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

  // 全局身份登录（ADR-0032）：登录页不再有组织输入，也不再有按部署模式
  // 显隐组织输入框的自适应行为。
  it('has no organization input on the login page and sends only username and password', async () => {
    const { requests } = routeMock({ mode: 'multi', defaultOrg: 'acme' });
    wrapper = await mountView(LoginView);
    await flushPromises();

    expect(wrapper.find('[data-test="org"]').exists()).toBe(false);

    await setField(wrapper, '[data-test="username"]', 'bob');
    await setField(wrapper, '[data-test="password"]', 'secret');
    await wrapper.find('[data-test="login-submit"]').trigger('submit');
    await flushPromises();

    const login = requests.find((request) => request.url === '/api/console/login');
    expect(login).toBeDefined();
    expect(login!.body).toMatchObject({ username: 'bob', password: 'secret' });
    expect(login!.body).not.toHaveProperty('org');
  });

  it('hides the register entry on the login page in single mode', async () => {
    routeMock({ mode: 'single', defaultOrg: 'acme' });
    wrapper = await mountView(LoginView);
    await flushPromises();

    expect(wrapper.find('[data-test="register-link"]').exists()).toBe(false);
  });

  // 部署模式（ADR-0022）已随 ADR-0032 废除：注册页始终展示组织名申请表单，
  // 由服务端按 org_registration_mode 决定拒绝或受理。
  it('always shows the organization application form on the register page', async () => {
    routeMock({ mode: 'multi', defaultOrg: null });
    wrapper = await mountView(RegisterView);
    await flushPromises();

    expect(wrapper.find('[data-test="org-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="register-submit"]').exists()).toBe(true);
  });
});
