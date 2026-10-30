import {
  credentialsForInstance,
  discoverServerIdentity,
  findServerInstanceByAddress,
  findServerInstanceById,
  instanceAddressCandidates,
  loadConfig,
  loadCredentials,
  normalizeServerUrl,
  resolveLocalStorePaths,
  resolveProjectStorePaths,
  saveConfig,
  skillSourceDirectoryName,
  addServerAddress,
  type LocalStoreOptions,
  type OrganizationMembership,
  type ServerRegistry
} from '@esl/core';
import path from 'node:path';
import { requireOkResponse } from '../api-error.js';
import { readCliVersion } from '../version.js';
import { DEFAULT_ESL_SERVER, resolveServer } from './config.js';

export interface NetworkCommandOptions extends LocalStoreOptions {
  server?: string;
  customFetch?: typeof fetch;
  builtinDir?: string;
}

export interface ResolvedNetworkConfig {
  server: string;
  token: string | null;
}

export async function resolveNetworkConfig(options: NetworkCommandOptions): Promise<ResolvedNetworkConfig> {
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  const instanceId = config?.selectedInstanceId ?? null;
  return {
    server: await resolveServer({ server: options.server, homeDir: options.homeDir }),
    token: credentialsForInstance(credentials, instanceId).token
  };
}

export interface ResolvedServerContext {
  server: string;
  instanceId: string;
  token: string | null;
}

function registryFromConfig(config: {
  servers?: unknown;
  selectedInstanceId?: string | null;
}): ServerRegistry {
  return {
    instances: Array.isArray(config.servers) ? config.servers : [],
    selectedInstanceId: config.selectedInstanceId ?? null
  };
}

async function tokenForInstance(options: LocalStoreOptions, instanceId: string): Promise<string | null> {
  let credentials;
  try {
    credentials = await loadCredentials({ homeDir: options.homeDir });
  } catch {
    return null;
  }
  return credentialsForInstance(credentials, instanceId).token;
}

/**
 * 远程命令的来源上下文（ADR-0071）：解析地址、确认/发现 Instance ID，并按实例
 * 取凭据。地址已登记却返回不同 ID 时 fail-closed；新地址声明已知实例时要求先
 * 走 `esl config server add` 的确认流程。
 */
export async function resolveServerContext(
  options: NetworkCommandOptions,
  context: { requireIdentity?: boolean } = {}
): Promise<{ server: string; instanceId: string | null; token: string | null }> {
  const requireIdentity = context.requireIdentity !== false;
  let config;
  try {
    config = await loadConfig({ homeDir: options.homeDir });
  } catch {
    config = null;
  }
  const registry = registryFromConfig(config ?? {});
  const requested = options.server ?? process.env.ESL_SERVER ?? config?.server ?? DEFAULT_ESL_SERVER;
  const server = normalizeServerUrl(requested);

  const registered = findServerInstanceByAddress(registry, server);
  if (registered) {
    let identity: Awaited<ReturnType<typeof discoverServerIdentity>>;
    try {
      identity = await discoverServerIdentity(server, { fetchImpl: options.customFetch });
    } catch (error) {
      if (!requireIdentity) {
        return {
          server,
          instanceId: registered.instance.instanceId,
          token: await tokenForInstance(options, registered.instance.instanceId)
        };
      }
      // 首选地址不可用：尝试同实例其他已确认地址（迁移/临时故障回退）。
      for (const candidate of instanceAddressCandidates(registered.instance)) {
        if (candidate === server) continue;
        try {
          const fallbackIdentity = await discoverServerIdentity(candidate, { fetchImpl: options.customFetch });
          if (fallbackIdentity.instanceId === registered.instance.instanceId) {
            return {
              server: candidate,
              instanceId: fallbackIdentity.instanceId,
              token: await tokenForInstance(options, fallbackIdentity.instanceId)
            };
          }
        } catch {
          // 继续尝试下一个地址。
        }
      }
      throw new Error(
        `Unable to confirm ESL Server instance ${registered.instance.instanceId} at ${server}: ${(error as Error).message} ` +
          'Remote commands need a reachable Server; local commands remain available.'
      );
    }
    if (identity.instanceId !== registered.instance.instanceId) {
      // 已登记地址换了身份：绝不静默改绑，也不把流量切到别的地址掩盖异常。
      throw new Error(
        `Address ${server} is registered to ESL Server instance ${registered.instance.instanceId}, ` +
          `but it now reports ${identity.instanceId}. Refusing to continue with a silent rebind; ` +
          `remove the old registration first ("esl config server remove ${server}") and confirm the new Server explicitly.`
      );
    }
    return {
      server,
      instanceId: registered.instance.instanceId,
      token: await tokenForInstance(options, registered.instance.instanceId)
    };
  }

  let discovered;
  try {
    discovered = await discoverServerIdentity(server, { fetchImpl: options.customFetch });
  } catch (error) {
    if (!requireIdentity) {
      return { server, instanceId: null, token: await loadCredentials({ homeDir: options.homeDir }).then((c) => c.token).catch(() => null) };
    }
    throw new Error(
      `${(error as Error).message} Remote commands need the Server Instance ID to isolate skill sources; ` +
        'local commands continue to work without it.'
    );
  }

  const known = findServerInstanceById(registry, discovered.instanceId);
  if (known) {
    throw new Error(
      `${server} claims to be ESL Server instance ${known.instanceId}, which is already registered at ` +
        `${known.addresses.map((address) => address.url).join(', ')}. Instance IDs are not cryptographic proof: ` +
        `verify the endpoint, then register it with "esl config server add ${server} --accept-new-address".`
    );
  }

  // 未知实例：按新来源登记，不迁移任何旧实例数据（新地址不会误接管已知来源）。
  try {
    const registration = addServerAddress(registry, { instanceId: discovered.instanceId, url: server });
    await saveConfig(
      { servers: registration.registry.instances, selectedInstanceId: registration.registry.selectedInstanceId },
      { homeDir: options.homeDir }
    );
  } catch {
    // 登记失败不影响本次只读/安装请求；下一次命令会重新发现。
  }
  return { server, instanceId: discovered.instanceId, token: await tokenForInstance(options, discovered.instanceId) };
}

export function requireServerContext(
  options: NetworkCommandOptions
): Promise<ResolvedServerContext> {
  return resolveServerContext(options, { requireIdentity: true }) as Promise<ResolvedServerContext>;
}

export function requireConfigured(value: string | null | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}; run esl login or pass --${name}`);
  }
  return value;
}

// ADR-0021 后续：403 通常意味着技能由其他账号/组织维护（各组织账号相互独立）。
// 在原始错误后附加可行动指引，替代裸 403 信息。
function withAuthGuidance(message: string): string {
  return `${message}\nThis skill may be maintained by another account or organization; log in with the maintaining organization ("esl login") and retry.`;
}

// 403 时附加跨账号指引，其余状态码原样返回。
export function withAuthGuidanceIfForbidden(status: number, message: string): string {
  return status === 403 ? withAuthGuidance(message) : message;
}

export function resolveTimeoutMs(): number {
  const env = process.env.ESL_HTTP_TIMEOUT;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 30_000;
}

export function resolveLoginTtlMs(): number {
  const env = process.env.ESL_LOGIN_TTL_HOURS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 3_600_000;
    }
  }
  return 720 * 3_600_000;
}

// 登录是否仍在 TTL 有效期内（本地时间戳判断，不向服务器验证）。
export function isLoginFresh(loginAt: string | null | undefined): boolean {
  if (!loginAt) {
    return false;
  }
  const loginAtMs = Date.parse(loginAt);
  return !Number.isNaN(loginAtMs) && Date.now() - loginAtMs <= resolveLoginTtlMs();
}

export async function requireFreshToken(options: LocalStoreOptions = {}): Promise<string> {
  const credentials = await loadCredentials({ homeDir: options.homeDir });
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  const selected = credentialsForInstance(credentials, config?.selectedInstanceId ?? null);
  const token = requireConfigured(selected.token, 'token');
  if (!isLoginFresh(selected.loginAt)) {
    throw new Error('Login expired; run esl login to re-authenticate');
  }
  return token;
}

// 匿名也可用的请求所用尽力而为的凭据：登录仍在有效期则返回 token，缺失或过期返回 null（调用方按匿名处理）。
export async function resolveOptionalFreshToken(options: LocalStoreOptions = {}): Promise<string | null> {
  let token: string | null;
  let loginAt: string | null;
  try {
    const credentials = await loadCredentials({ homeDir: options.homeDir });
    const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
    const selected = credentialsForInstance(credentials, config?.selectedInstanceId ?? null);
    token = selected.token;
    loginAt = selected.loginAt;
  } catch {
    return null;
  }
  if (!token || !isLoginFresh(loginAt)) {
    return null;
  }
  return token;
}

let cachedUserAgent: string | null = null;

// 请求上报（#136）：所有 API 请求统一携带 `esl/<CLI 版本> node/<Node 版本> <platform>/<arch>`。
// CLI 版本取自 CLI 包自身的 package.json，结果进程内缓存（一次磁盘读取足够）。
export function resolveUserAgent(): string {
  if (cachedUserAgent === null) {
    const nodeVersion = process.version.replace(/^v/, '');
    cachedUserAgent = `esl/${readCliVersion()} node/${nodeVersion} ${process.platform}/${process.arch}`;
  }
  return cachedUserAgent;
}

// 合并请求头：用平台 Headers 统一归一化（对象/数组/Headers 三种入参都支持），
// 仅在没有 User-Agent 时补默认值，绝不覆盖调用方已显式给出的头（Authorization 等）。
// HTTP 头名大小写不敏感，归一化后统一为小写形态交给 fetch。
function withDefaultHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const merged = new Headers(headers);
  if (!merged.has('user-agent')) {
    merged.set('User-Agent', resolveUserAgent());
  }
  return Object.fromEntries(merged.entries());
}

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = resolveTimeoutMs()
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      headers: withDefaultHeaders(init.headers),
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted && (error as Error)?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/$/, '');
  return `${base}${path}`;
}

// 取登录账号的资料（当前用户邮箱）。失败语义交给调用方：登录时 try/catch 降级，
// whoami --online 时让错误上抛。
export async function fetchAccountProfile(
  server: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<{ email: string | null }> {
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/account/profile'), {
    headers: { Authorization: `token ${token}` }
  });
  await requireOkResponse(res, 'Failed to fetch account profile');
  const data = (await res.json()) as { email?: unknown };
  return { email: typeof data.email === 'string' && data.email.length > 0 ? data.email : null };
}

// 取登录账号的组织隶属关系（实时）。与 init 的 namespace 菜单同一口径：deleting /
// delete_failed 的组织不属于可正常使用的组织，过滤掉；返回形状与登录响应一致，
// 不带服务端附加的 status。
export async function fetchMyOrganizations(
  server: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<OrganizationMembership[]> {
  const res = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/orgs/mine'), {
    headers: { Authorization: `token ${token}` }
  });
  await requireOkResponse(res, 'Failed to fetch organization memberships');
  const data = (await res.json()) as {
    organizations?: (OrganizationMembership & { status?: string })[];
  };
  if (!Array.isArray(data.organizations)) {
    return [];
  }
  return data.organizations
    .filter((membership) => !membership.status || membership.status === 'active')
    .map(({ org, identity, isOwnerMember }) => ({ org, identity, isOwnerMember }));
}

// 解析 http(s) URL 的 origin（scheme://host[:port]）；非 http(s) 或无法解析时返回 null。
export function parseHttpOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

// ADR-0023：Source Remote origin 与当前配置 ESL Server origin 是否漂移
// （Server Origin 迁移检测）。任一侧不是 http(s) 时视为无漂移，维持既有行为。
export function sourceRemoteOriginDrifted(remoteUrl: string, server: string): boolean {
  const remoteOrigin = parseHttpOrigin(remoteUrl);
  const serverOrigin = parseHttpOrigin(server);
  return remoteOrigin !== null && serverOrigin !== null && remoteOrigin !== serverOrigin;
}

export function gitAuthHeaderConfig(token: string): string {
  return `http.extraHeader=Authorization: Bearer ${token}`;
}

export function installTargetDir(
  skillName: string,
  options: LocalStoreOptions,
  instanceId?: string | null
): string {
  return path.join(
    resolveLocalStorePaths(options).skillsDir,
    instanceId ? path.join(instanceId, skillSourceDirectoryName(skillName)) : skillSourceDirectoryName(skillName)
  );
}

export function projectSkillsDir(
  projectRoot: string,
  skillName: string,
  instanceId?: string | null
): string {
  return path.join(
    resolveProjectStorePaths(projectRoot).skillsDir,
    instanceId ? path.join(instanceId, skillSourceDirectoryName(skillName)) : skillSourceDirectoryName(skillName)
  );
}

export function publishedInstallTargetDir(
  skillName: string,
  options: LocalStoreOptions,
  instanceId?: string | null
): string {
  return installTargetDir(skillName, options, instanceId);
}

export function publishedProjectSkillsDir(
  projectRoot: string,
  skillName: string,
  instanceId?: string | null
): string {
  return projectSkillsDir(projectRoot, skillName, instanceId);
}
