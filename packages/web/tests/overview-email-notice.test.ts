import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import OverviewView from '../src/views/me/OverviewView.vue';
import { router } from '../src/router';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  await resetConsole();
});

function mockOverview(email: Record<string, unknown>): void {
  useApiMock((method, url) => {
    if (method === 'GET' && url === '/api/orgs/invitations') {
      return { status: 200, json: [] };
    }
    if (method === 'GET' && url === '/api/orgs/mine') {
      return { status: 200, json: { organizations: [], pendingApplications: [] } };
    }
    if (method === 'GET' && url === '/api/account/profile') {
      return { status: 200, json: { username: 'carol', email: 'carol@example.com', ...email } };
    }
    return { status: 200, json: [] };
  });
}

describe('概览页邮箱提醒横幅', () => {
  it('待补全用户看到醒目横幅，点击后跳到个人信息页邮箱区块并高亮', async () => {
    mockOverview({ emailPendingCompletion: true });
    wrapper = await mountConsoleView(App, { account: 'solo', route: '/admin/me/overview' });
    await flushPromises();

    const notice = wrapper.find('[data-test="email-notice-warning"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('当前邮箱尚未补全');
    expect(wrapper.find('[data-test="profile-email-input"]').exists()).toBe(false);

    await wrapper.find('[data-test="go-personal-info"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('me-personal-info');
    expect(router.currentRoute.value.hash).toBe('#email');
    expect(wrapper.find('[data-test="personal-info-card"]').classes()).toContain('is-highlighted');
  });

  it('待验证用户看到低强度提示，且不出现邮箱表单', async () => {
    mockOverview({ emailPendingCompletion: false, emailPendingVerification: true });
    wrapper = await mountConsoleView(OverviewView, { account: 'solo', route: '/admin/me/overview' });
    await flushPromises();

    const notice = wrapper.find('[data-test="email-notice-info"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain('新邮箱正在等待验证');
    expect(wrapper.find('[data-test="profile-email-submit"]').exists()).toBe(false);

    await wrapper.find('[data-test="go-personal-info"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('me-personal-info');
    expect(router.currentRoute.value.hash).toBe('#email');
  });

  it('待补全且待验证时以待验证提示为准', async () => {
    mockOverview({ emailPendingCompletion: true, emailPendingVerification: true });
    wrapper = await mountConsoleView(OverviewView, { account: 'solo', route: '/admin/me/overview' });
    await flushPromises();

    expect(wrapper.find('[data-test="email-notice-info"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="email-notice-warning"]').exists()).toBe(false);
  });

  it('邮箱状态正常时不渲染提醒横幅', async () => {
    mockOverview({ emailPendingCompletion: false });
    wrapper = await mountConsoleView(OverviewView, { account: 'solo', route: '/admin/me/overview' });
    await flushPromises();

    expect(wrapper.find('[data-test="email-notice-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="email-notice-info"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="profile-email"]').exists()).toBe(false);
  });
});
