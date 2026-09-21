import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import OverviewView from '../src/views/me/OverviewView.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  await resetConsole();
});

async function setInput(view: VueWrapper, testId: string, value: string): Promise<void> {
  const input = view.find(testId);
  (input.element as HTMLInputElement).value = value;
  await input.trigger('input');
}

describe('Personal Console Skill User Email', () => {
  it('展示待补全提醒并携带当前密码提交新邮箱', async () => {
    const { requests } = useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/account/profile') {
        return {
          status: 200,
          json: {
            username: 'legacy',
            email: 'legacy@local.esl',
            emailPendingCompletion: true
          }
        };
      }
      if (method === 'PUT' && url === '/api/account/email') {
        return {
          status: 200,
          json: {
            username: 'legacy',
            email: 'legacy@example.com',
            emailPendingCompletion: false
          }
        };
      }
      if (method === 'GET' && url === '/api/orgs/mine') {
        return { status: 200, json: { organizations: [], pendingApplications: [] } };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(OverviewView, { account: 'solo', route: '/admin/me/overview' });
    await flushPromises();

    expect(wrapper.find('[data-test="email-pending-reminder"]').text()).toContain('邮箱待补全');
    expect(wrapper.find('[data-test="profile-email"]').text()).toContain('legacy@local.esl');

    await setInput(wrapper, '[data-test="profile-email-input"]', 'legacy@example.com');
    await setInput(wrapper, '[data-test="profile-current-password"]', 'legacy-password');
    await wrapper.find('[data-test="profile-email-submit"]').trigger('click');
    await flushPromises();

    const request = requests.find((item) => item.method === 'PUT' && item.url === '/api/account/email');
    expect(request?.body).toEqual({
      email: 'legacy@example.com',
      currentPassword: 'legacy-password'
    });
  });
});
