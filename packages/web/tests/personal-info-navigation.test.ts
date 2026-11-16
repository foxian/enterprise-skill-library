import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import ConsoleShell from '../src/components/layout/ConsoleShell.vue';
import App from '../src/App.vue';
import { router } from '../src/router';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  await resetConsole();
});

describe('个人信息入口', () => {
  it('侧边栏第二项为个人信息，进入后高亮并加载邮箱', async () => {
    useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/account/profile') {
        return {
          status: 200,
          json: { username: 'carol', email: 'carol@example.com', emailPendingCompletion: false }
        };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(App, { account: 'solo', route: '/admin/me/personal-info' });
    await flushPromises();

    const labels = wrapper.findAll('.el-menu-item').map((item) => item.text());
    expect(labels).toEqual(['概览', '个人信息', '我的组织', '技能', '邀请']);
    const active = wrapper.findAll('.el-menu-item').find((item) => item.text() === '个人信息');
    expect(active?.classes()).toContain('is-active');
    expect(wrapper.find('[data-test="profile-email"]').text()).toContain('carol@example.com');
  });

  it('头像下拉菜单提供个人信息并可跳转到该页', async () => {
    useApiMock(() => ({ status: 200, json: {} }));
    wrapper = await mountConsoleView(ConsoleShell as never, {
      account: 'member',
      route: '/admin/me/skills',
      props: { brand: '工作台', menuItems: [] }
    });
    await flushPromises();

    await wrapper.find('[data-test="user-dropdown"]').trigger('click');
    await flushPromises();

    const item = wrapper.find('[data-test="personal-info"]');
    expect(item.text()).toBe('个人信息');
    await item.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('me-personal-info');
  });

  it('超管控制台不渲染个人信息入口', async () => {
    useApiMock(() => ({ status: 200, json: {} }));
    wrapper = await mountConsoleView(ConsoleShell as never, {
      account: 'platformAdmin',
      route: '/admin/super/dashboard',
      props: { brand: '工作台', menuItems: [] }
    });
    await flushPromises();

    await wrapper.find('[data-test="user-dropdown"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="personal-info"]').exists()).toBe(false);
  });
});
