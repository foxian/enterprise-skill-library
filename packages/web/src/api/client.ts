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

// Operation 状态流(SSE)事件:与 GET /api/operations/:id/stream 推送的数据一致。
export interface OperationStreamEvent {
  operationId: number;
  status: string;
  error: string | null;
}

export interface OperationStreamOptions {
  // 匿名申请人订阅 organization.provision 开通流时携带的初始密码;
  // 已登录用户无需此字段(走 Authorization token)。
  orgPassword?: string;
  onEvent: (event: OperationStreamEvent) => void;
  onError?: (error: Error) => void;
}

export interface OperationStream {
  close: () => void;
}

// 订阅一次跨系统 Operation 的状态流。连接建立后服务端先推送当前状态,
// 之后每次 settle(succeeded / permanently_failed)增量推送,无需轮询。
// 使用 fetch + ReadableStream 解析 SSE:原生 EventSource 无法携带自定义
// Authorization / X-Org-Password 头。返回 close() 用于取消订阅并断开连接。
export function openOperationStream(operationId: number, options: OperationStreamOptions): OperationStream {
  const auth = useAuthStore();
  const headers: Record<string, string> = {};
  if (auth.token) {
    headers.Authorization = `token ${auth.token}`;
  }
  if (options.orgPassword) {
    headers['X-Org-Password'] = options.orgPassword;
  }
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetchImpl(`/api/operations/${operationId}/stream`, {
        headers,
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const text = await response.text();
        let message = text;
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          // 非 JSON 错误体,直接展示原文
        }
        throw new ApiError(response.status, message || `请求失败（HTTP ${response.status}）`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator: number;
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
              options.onEvent(JSON.parse(line.slice(6)) as OperationStreamEvent);
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { close: () => controller.abort() };
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
