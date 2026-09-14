import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import { setFetchImpl } from '../src/api/client';
import { useAuthStore, type AuthSession } from '../src/stores/auth';

// 记录请求并按路由表返回响应的 fetch mock（测试接缝）
export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

export type MockHandler = (
  method: string,
  url: string,
  body: unknown
) => { status: number; json: unknown };

export function useApiMock(handler: MockHandler): { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  setFetchImpl(
    (async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      requests.push({ method, url: String(url), body });
      const { status, json } = handler(method, String(url), body);
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch
  );
  return { requests };
}

/**
 * 测试用账号画像（ADR-0033）：平台角色只有"是/不是平台管理员"，组织治理权
 * 逐组织声明。这里覆盖四种典型形态，而不是三个"角色"。
 */
export type AccountKind = 'platformAdmin' | 'orgManager' | 'member' | 'solo';

const ACCOUNTS: Record<AccountKind, AuthSession> = {
  platformAdmin: { token: 'super-token', username: 'eslroot', isPlatformAdmin: true, organizations: [] },
  orgManager: {
    token: 'org-manager-token',
    username: 'admin',
    isPlatformAdmin: false,
    organizations: [{ org: 'acme', isOrgManager: true }]
  },
  member: {
    token: 'member-token',
    username: 'bob',
    isPlatformAdmin: false,
    organizations: [{ org: 'acme', isOrgManager: false }]
  },
  solo: { token: 'solo-token', username: 'carol', isPlatformAdmin: false, organizations: [] }
};

// 建立指定账号的会话并导航到目标路由后挂载视图。
// 挂载到 document.body 上，使未开启 append-to-body 的 el-dialog 内容也可用 document 查询。
export async function mountConsoleView(
  component: Component,
  options: { account: AccountKind; route: string; props?: Record<string, unknown> }
): Promise<VueWrapper> {
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().establish(ACCOUNTS[options.account]);
  await router.push(options.route);
  await router.isReady();
  const container = document.createElement('div');
  document.body.appendChild(container);
  return mount(component as unknown as Component, {
    attachTo: container,
    props: options.props,
    global: {
      plugins: [pinia, ElementPlus, router]
    }
  });
}

export async function resetConsole(): Promise<void> {
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().logout();
  await router.push('/admin/login');
}
