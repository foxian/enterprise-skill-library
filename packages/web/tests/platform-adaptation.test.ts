import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import LoginView from '../src/views/LoginView.vue';
import { useApiMock } from './helpers';

// 按 URL 路由的 fetch mock：platform-info 与登录/注册端点返回各自响应
function routeMock(info: { registrationMode: string; memberAddMode: string; orgRegistrationMode: string }) {
  return useApiMock((method, url, body) => {
    if (url === '/api/public/platform-info') return { status: 200, json: info };
    if (url === '/api/console/login') {
      return {
        status: 200,
        json: { token: 't', username: 'bob', isPlatformAdmin: false, organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }] }
      };
    }
    if (url === '/api/orgs/applications') {
      return { status: 201, json: { status: 'pending', applicationId: 1 } };
    }
    return { status: 404, json: {} };
  });
}

const OPEN_PLATFORM = { registrationMode: 'open', memberAddMode: 'direct', orgRegistrationMode: 'auto' };

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

  // 全局身份登录（ADR-0032）：登录页不再有组织输入；部署模式（ADR-0022）已废除，
  // 因此也没有按模式自适应显隐的行为。
  it('has no organization input on the login page and sends only username and password', async () => {
    const { requests } = routeMock(OPEN_PLATFORM);
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

  // 回归：登录页曾有一个「没有组织？注册组织申请」入口，通向公开的 /admin/register。
  // 组织不属于登录前的上下文——`POST /api/orgs/applications` 要 token，匿名访客点
  // 进去只会拿到 401。组织申请是已登录 Skill User 在个人控制台「我的组织」里的动作
  // （ADR-0032/0035），登录页只留账号注册。
  it('offers only account registration on the login page, never an organization entry', async () => {
    routeMock(OPEN_PLATFORM);
    wrapper = await mountView(LoginView);
    await flushPromises();

    expect(wrapper.find('[data-test="user-register-link"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="register-link"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('注册组织申请');
  });
});
