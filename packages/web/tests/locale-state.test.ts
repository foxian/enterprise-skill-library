import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { initializeLocale, useLocaleState } from '../src/i18n/locale';
import { setFetchImpl } from '../src/api/client';
import LoginView from '../src/views/LoginView.vue';
import UserRegisterView from '../src/views/UserRegisterView.vue';
import SuperLayout from '../src/views/super/SuperLayout.vue';
import { mountConsoleView } from './helpers';
import { useAuthStore, type AuthSession } from '../src/stores/auth';

function establish(session: AuthSession): void {
  useAuthStore().establish(session);
}

describe('web locale state', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    document.cookie = 'esl-locale=; Max-Age=0; path=/';
    localStorage.clear();
    setFetchImpl(() => {
      throw new Error('unexpected fetch');
    });
  });

  afterEach(async () => {
    document.cookie = 'esl-locale=; Max-Age=0; path=/';
  });

  it('uses the account locale before the browser language and default', async () => {
    establish({
      token: 'token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [],
      locale: 'zh-CN'
    });
    await initializeLocale({ browserLanguages: ['en-US'] });

    const locale = useLocaleState();

    expect(locale.current.value).toBe('zh-CN');
  });

  it('keeps an anonymous choice in a cookie even when the browser language differs', async () => {
    document.cookie = 'esl-locale=zh-CN; path=/';
    await initializeLocale({ browserLanguages: ['en-US'] });

    const locale = useLocaleState();

    expect(locale.current.value).toBe('zh-CN');
  });

  it('falls back to English for an unsupported browser language', async () => {
    await initializeLocale({ browserLanguages: ['fr-FR'] });

    const locale = useLocaleState();

    expect(locale.current.value).toBe('en-US');
  });

  it('switches immediately, saves an account preference, and updates the session', async () => {
    establish({
      token: 'token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [],
      locale: 'zh-CN'
    });
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    setFetchImpl((async (url: string | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? 'GET', url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ locale: 'en-US' }), { status: 200 });
    }) as typeof fetch);
    await initializeLocale({ browserLanguages: ['zh-CN'] });

    const locale = useLocaleState();
    await locale.setLocale('en-US');

    expect(locale.current.value).toBe('en-US');
    expect(locale.t('auth.login')).toBe('Sign in');
    expect(useAuthStore().accountLocale).toBe('en-US');
    expect(requests).toEqual([
      { method: 'PUT', url: '/api/account/preferences', body: { locale: 'en-US' } }
    ]);
  });

  it('switches an anonymous choice immediately and persists it in a cookie', async () => {
    await initializeLocale({ browserLanguages: ['zh-CN'] });

    const locale = useLocaleState();
    await locale.setLocale('en-US');

    expect(locale.current.value).toBe('en-US');
    expect(locale.t('auth.login')).toBe('Sign in');
    expect(document.cookie).toContain('esl-locale=en-US');
  });

  it('still switches the UI when saving the account preference fails', async () => {
    establish({
      token: 'token',
      username: 'bob',
      isPlatformAdmin: false,
      organizations: [],
      locale: 'zh-CN'
    });
    setFetchImpl((async () => new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 })) as typeof fetch);
    await initializeLocale({ browserLanguages: ['zh-CN'] });

    const locale = useLocaleState();
    await locale.setLocale('en-US');

    expect(locale.current.value).toBe('en-US');
    expect(locale.t('auth.login')).toBe('Sign in');
    expect(document.cookie).toContain('esl-locale=en-US');
  });

  it('changes the login page copy immediately from the locale switch', async () => {
    document.cookie = 'esl-locale=zh-CN; path=/';
    await initializeLocale({ browserLanguages: ['en-US'] });

    const wrapper = mount(LoginView, {
      global: { plugins: [ElementPlus] }
    });
    const englishControl = wrapper.find('[data-test="locale-en-US"]');
    const englishInput = englishControl.find('input');
    if (englishInput.exists()) {
      await englishInput.setValue('en-US');
    } else {
      await englishControl.trigger('click');
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.auth-title').text()).toBe('ESL Skill Library');
    expect(wrapper.find('.auth-subtitle').text()).toBe('Admin console sign in');
    expect(wrapper.find('[data-test="login-submit"]').text()).toContain('Sign in');
    expect(document.cookie).toContain('esl-locale=en-US');
    wrapper.unmount();
  });

  it('translates a structured registration API error into Chinese', async () => {
    document.cookie = 'esl-locale=zh-CN; path=/';
    await initializeLocale({ browserLanguages: ['en-US'] });
    setFetchImpl((async (url: string | URL) => {
      if (String(url) === '/api/auth/register') {
        return new Response(
          JSON.stringify({
            code: 'usernameAlreadyTaken',
            params: { username: 'dave' },
            message: 'Username is already taken: dave'
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch);

    const wrapper = mount(UserRegisterView, { global: { plugins: [ElementPlus] } });
    const setUsername = wrapper.find('[data-test="register-username"]');
    (setUsername.element as HTMLInputElement).value = 'dave';
    await setUsername.trigger('input');
    const setPassword = wrapper.find('[data-test="register-password"]');
    (setPassword.element as HTMLInputElement).value = 'a-valid-password';
    await setPassword.trigger('input');
    const setConfirm = wrapper.find('[data-test="register-confirm"]');
    (setConfirm.element as HTMLInputElement).value = 'a-valid-password';
    await setConfirm.trigger('input');
    await wrapper.find('[data-test="register-submit"]').trigger('submit');
    await flushPromises();

    expect(wrapper.find('[data-test="register-error"]').text()).toContain('用户名已被占用：dave');
    wrapper.unmount();
  });

  it('changes the registration page copy to English', async () => {
    document.cookie = 'esl-locale=en-US; path=/';
    await initializeLocale({ browserLanguages: ['zh-CN'] });

    const wrapper = mount(UserRegisterView, { global: { plugins: [ElementPlus] } });

    expect(wrapper.find('.auth-title').text()).toBe('Register an ESL account');
    expect(wrapper.find('.auth-subtitle').text()).toBe('Registration creates a personal namespace @username');
    expect(wrapper.text()).toContain('Username');
    expect(wrapper.text()).toContain('Register');
    expect(wrapper.text()).toContain('Already have an account? Sign in');
    wrapper.unmount();
  });

  it('translates console navigation, titles, and role labels', async () => {
    document.cookie = 'esl-locale=en-US; path=/';
    await initializeLocale({ browserLanguages: ['en-US'] });

    const wrapper = await mountConsoleView(SuperLayout as never, {
      account: 'platformAdmin',
      route: '/admin/super/dashboard'
    });

    expect(wrapper.find('.console-header-name').text()).toBe('Platform overview');
    expect(wrapper.find('.console-header-desc').text()).toBe('Realtime summary of organizations, approvals, and skills');
    expect(wrapper.find('.console-menu').text()).toContain('Platform overview');
    expect(wrapper.find('.console-menu').text()).toContain('Organization management');
    expect(wrapper.find('.console-user-role').text()).toBe('Platform administrator');
    wrapper.unmount();
  });
});
