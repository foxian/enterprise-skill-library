﻿﻿﻿import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils';
import { ElDialog } from 'element-plus';
import ConsoleShell from '../src/components/layout/ConsoleShell.vue';
import ChangePasswordDialog from '../src/components/ChangePasswordDialog.vue';
import { mountConsoleView, resetConsole, useApiMock } from './helpers';

// el-dialog 内容渲染在 body 的 teleport 层，从 document 查找
function doc(testId: string): DOMWrapper<Element> {
  const element = document.querySelector(`[data-test="${testId}"]`);
  if (!element) {
    throw new Error(`[data-test="${testId}"] not found in document`);
  }
  return new DOMWrapper(element);
}

async function setDocInput(testId: string, value: string): Promise<void> {
  const input = doc(testId).element as HTMLInputElement;
  input.value = value;
  await doc(testId).trigger('input');
}

// 修改密码入口收在用户下拉菜单里,先展开再操作
async function openChangePassword(view: VueWrapper): Promise<void> {
  await view.find('[data-test="user-dropdown"]').trigger('click');
  await flushPromises();
  await view.find('[data-test="change-password"]').trigger('click');
  await flushPromises();
}

let wrapper: VueWrapper | undefined;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  await resetConsole();
});

describe('ConsoleShell 侧边栏用户菜单 修改密码', () => {
  it('侧边栏左下角打开修改密码对话框并提交自服务改密请求', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/auth/password') {
        return { status: 200, json: { passwordChanged: true } };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(ConsoleShell as never, { role: 'member', route: '/admin/member/skills', props: { brand: '墨库', menuItems: [] } });
    await flushPromises();

    await openChangePassword(wrapper);

    await setDocInput('current-password', 'old-pass');
    await setDocInput('new-password', 'new-pass-123');
    await setDocInput('confirm-password', 'new-pass-123');
    await doc('change-password-submit').trigger('click');
    await flushPromises();

    const request = requests.find((item) => item.method === 'POST' && item.url === '/api/auth/password');
    expect(request?.body).toEqual({ oldPassword: 'old-pass', newPassword: 'new-pass-123' });
    // 成功后对话框关闭（el-dialog 关闭动画期间 teleport 层仍在 DOM，断言组件状态而非 DOM）
    expect(wrapper.findComponent(ChangePasswordDialog).findComponent(ElDialog).props('modelValue')).toBe(false);
    expect(document.querySelector('[data-test="change-password-error"]')).toBeNull();
  });

  it('两次新密码不一致时禁用提交按钮', async () => {
    useApiMock(() => ({ status: 200, json: {} }));
    wrapper = await mountConsoleView(ConsoleShell as never, { role: 'super', route: '/admin/super/dashboard', props: { brand: '墨库', menuItems: [] } });
    await flushPromises();

    await openChangePassword(wrapper);

    await setDocInput('current-password', 'old-pass');
    await setDocInput('new-password', 'new-pass-1');
    await setDocInput('confirm-password', 'new-pass-2');

    expect((doc('change-password-submit').element as HTMLButtonElement).disabled).toBe(true);
  });

  it('改密失败时展示服务端错误且对话框保持打开', async () => {
    const { requests } = useApiMock((method, url) => {
      if (url === '/api/auth/password') {
        return { status: 401, json: { error: 'Unauthorized: current password is incorrect' } };
      }
      return { status: 200, json: {} };
    });
    wrapper = await mountConsoleView(ConsoleShell as never, { role: 'member', route: '/admin/member/skills', props: { brand: '墨库', menuItems: [] } });
    await flushPromises();

    await openChangePassword(wrapper);
    await setDocInput('current-password', 'wrong-pass');
    await setDocInput('new-password', 'new-pass-123');
    await setDocInput('confirm-password', 'new-pass-123');
    await doc('change-password-submit').trigger('click');
    await flushPromises();

    expect(requests.some((item) => item.method === 'POST' && item.url === '/api/auth/password')).toBe(true);
    expect(doc('change-password-error').text()).toContain('current password is incorrect');
    expect(document.querySelector('[data-test="current-password"]')).not.toBeNull();
  });
});
