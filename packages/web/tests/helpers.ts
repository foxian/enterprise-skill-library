import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import type { Component } from 'vue';
import { router } from '../src/router';
import { setFetchImpl } from '../src/api/client';
import { useAuthStore, type Role } from '../src/stores/auth';

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

const ROLE_ACCOUNTS: Record<Role, { username: string; org: string | null }> = {
  super: { username: 'eslroot', org: null },
  'org-admin': { username: 'admin', org: 'acme' },
  member: { username: 'bob', org: 'acme' }
};

// 建立指定角色会话并导航到目标路由后挂载视图。
// 挂载到 document.body 上，使未开启 append-to-body 的 el-dialog 内容也可用 document 查询。
export async function mountConsoleView(
  component: Component,
  options: { role: Role; route: string }
): Promise<VueWrapper> {
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  const account = ROLE_ACCOUNTS[options.role];
  useAuthStore().establish({ token: `${options.role}-token`, ...account, role: options.role });
  await router.push(options.route);
  await router.isReady();
  const container = document.createElement('div');
  document.body.appendChild(container);
  return mount(component as unknown as Component, {
    attachTo: container,
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
