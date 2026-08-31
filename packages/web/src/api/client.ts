import { useAuthStore } from '../stores/auth';

// 测试接缝：允许注入 mock fetch，不真实访问网络
let fetchImpl: typeof fetch = globalThis.fetch;

export function setFetchImpl(impl: typeof fetch): void {
  fetchImpl = impl;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) {
    headers.Authorization = `token ${auth.token}`;
  }
  const response = await fetchImpl(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  // 会话失效时清除本地登录态，交由路由守卫带回登录页；
  // 登录接口的 401 是凭证错误，仍走统一错误解析
  if (response.status === 401 && auth.isLoggedIn) {
    auth.logout();
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // 非 JSON 错误体，直接展示原文
    }
    throw new ApiError(response.status, message || `请求失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}
