import { useAuthStore } from '../stores/auth';

// 测试接缝：允许注入 mock fetch，不真实访问网络
let fetchImpl: typeof fetch = globalThis.fetch;

export function setFetchImpl(impl: typeof fetch): void {
  fetchImpl = impl;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly params: Record<string, string>;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    const structured = body && typeof body === 'object' ? body as { code?: unknown; params?: unknown } : null;
    this.code = typeof structured?.code === 'string' ? structured.code : undefined;
    this.params = structured?.params && typeof structured.params === 'object'
      ? Object.fromEntries(
          Object.entries(structured.params as Record<string, unknown>).map(([key, value]) => [key, String(value)])
        )
      : {};
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = {};
  // 仅在有请求体时声明 JSON，避免无 body 的 POST/DELETE 被 Fastify 以空 JSON body 拒绝
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
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
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // 非 JSON 错误体，直接展示原文
    }
    const payload = body && typeof body === 'object' ? body as { error?: unknown; message?: unknown } : null;
    const message = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : text;
    throw new ApiError(response.status, message || `Request failed (HTTP ${response.status})`, body);
  }
  return (await response.json()) as T;
}
