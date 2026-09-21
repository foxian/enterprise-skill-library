export interface ApiErrorBody {
  code?: unknown;
  params?: unknown;
  message?: unknown;
}

export class ApiError extends Error {
  readonly code?: string;
  readonly params: Record<string, string>;

  constructor(
    readonly status: number,
    readonly rawMessage: string,
    body: ApiErrorBody = {}
  ) {
    super(body.message && typeof body.message === 'string' ? body.message : rawMessage);
    this.name = 'ApiError';
    if (typeof body.code === 'string') this.code = body.code;
    this.params =
      body.params && typeof body.params === 'object' && !Array.isArray(body.params)
        ? Object.fromEntries(
            Object.entries(body.params as Record<string, unknown>).map(([key, value]) => [key, String(value)])
          )
        : {};
  }
}

export async function requireOkResponse(
  response: Response,
  fallback: string
): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  try {
    throw new ApiError(response.status, `${fallback}: ${text}`, JSON.parse(text) as ApiErrorBody);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(`${fallback}: ${text}`);
  }
}
