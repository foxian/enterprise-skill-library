import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import PersonalInfoView from '../src/views/me/PersonalInfoView.vue';
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

describe('个人信息页 用户邮箱', () => {
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
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(PersonalInfoView, { account: 'solo', route: '/admin/me/personal-info' });
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

  it('待验证状态展示待验证提醒', async () => {
    useApiMock((method, url) => {
      if (method === 'GET' && url === '/api/account/profile') {
        return {
          status: 200,
          json: {
            username: 'pending',
            email: 'pending@example.com',
            emailPendingCompletion: false,
            emailPendingVerification: true
          }
        };
      }
      return { status: 200, json: [] };
    });
    wrapper = await mountConsoleView(PersonalInfoView, { account: 'solo', route: '/admin/me/personal-info' });
    await flushPromises();

    expect(wrapper.find('[data-test="email-pending-reminder"]').text()).toContain('新邮箱待验证');
  });
});
