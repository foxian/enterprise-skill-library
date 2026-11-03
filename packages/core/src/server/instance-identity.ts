// ESL Server 实例身份与客户端本地登记（ADR-0071）。
//
// Instance ID 是 Server 首次初始化时生成并持久保存的随机 UUID。客户端只用它
// 表达「技能来源是哪一个实例」，不用它证明地址真实性：当前没有公钥/私钥
// 认证，相同 ID 只是连续性声明，所以新地址首次绑定必须由用户确认。

export const SERVER_IDENTITY_PATH = '/api/public/server-identity';
export const SERVER_IDENTITY_PROTOCOL_VERSION = 1;

const INSTANCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ServerIdentity {
  instanceId: string;
  protocolVersion: number;
}

export interface ServerAddressRecord {
  url: string;
  /** 用户接受该地址与实例 ID 绑定的本地记录；不是密码学信任。 */
  confirmedAt: string;
}

export interface ServerInstanceRecord {
  instanceId: string;
  addresses: ServerAddressRecord[];
  preferredAddress: string;
}

/**
 * 已保存但尚未确认 Instance ID 的地址（离线登记 / 身份发现失败）。
 * 地址本身是连接入口，确认前不归属任何实例，也不能用于认证。
 */
export interface PendingServerAddressRecord {
  url: string;
  addedAt: string;
  /** 用户显式声明的 Instance ID；仅在确认时用于校验，不构成信任。 */
  declaredInstanceId?: string | null;
}

export interface ServerRegistry {
  instances: ServerInstanceRecord[];
  selectedInstanceId: string | null;
  pendingAddresses?: PendingServerAddressRecord[];
}

export function createEmptyServerRegistry(): ServerRegistry {
  return { instances: [], selectedInstanceId: null, pendingAddresses: [] };
}

export function isValidInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID_PATTERN.test(value);
}

/**
 * 规范化用户输入的 Server 地址：去掉首尾空白与末尾斜杠，只接受 http(s)。
 * 返回可用于比较和请求的 origin+path（路径按用户原样保留）。
 */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Server URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Server URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported Server URL protocol: ${parsed.protocol}`);
  }
  return trimmed.replace(/\/+$/, '');
}

/** 规范化可解析地址；无效或空值返回 null，供只读/容错路径使用。 */
export function tryNormalizeServerUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return normalizeServerUrl(value);
  } catch {
    return null;
  }
}

/** 短前缀默认长度：工具链接目录既要可读，也要足以区分实例。 */
export const DEFAULT_INSTANCE_PREFIX_LENGTH = 6;

export function instanceIdPrefix(instanceId: string, length = DEFAULT_INSTANCE_PREFIX_LENGTH): string {
  const compact = instanceId.replace(/-/g, '').toLowerCase();
  return compact.slice(0, Math.max(1, Math.min(length, compact.length)));
}

export function findServerInstanceByAddress(
  registry: ServerRegistry,
  url: string
): { instance: ServerInstanceRecord; address: ServerAddressRecord } | null {
  for (const instance of registry.instances) {
    const address = instance.addresses.find((candidate) => candidate.url === url);
    if (address) {
      return { instance, address };
    }
  }
  return null;
}

export function findServerInstanceById(
  registry: ServerRegistry,
  instanceId: string
): ServerInstanceRecord | null {
  return registry.instances.find((instance) => instance.instanceId === instanceId) ?? null;
}

export function findPendingServerAddress(
  registry: ServerRegistry,
  url: string
): PendingServerAddressRecord | null {
  return (registry.pendingAddresses ?? []).find((address) => address.url === url) ?? null;
}

export type ServerIdentityStatus = 'confirmed' | 'unconfirmed' | 'legacy' | 'none';

export interface CurrentServerContext {
  server: string | null;
  status: ServerIdentityStatus;
  instanceId: string | null;
  instance: ServerInstanceRecord | null;
}

export interface CurrentServerInput {
  server?: string | null;
  servers?: ServerInstanceRecord[];
  selectedInstanceId?: string | null;
  pendingAddresses?: PendingServerAddressRecord[];
}

/**
 * 当前连接地址的权威身份。地址是连接入口：已登记地址的 Instance ID 决定当前
 * 实例；selectedInstanceId 只是普通远程命令的旧视图，不能盖过地址绑定。
 *
 * - confirmed：当前地址已登记到某个实例。
 * - unconfirmed：当前地址尚未确认身份（新地址发现失败 / 地址已换身份）。
 * - legacy：旧版单 Server 配置，尚未登记任何实例或待确认地址。
 * - none：还没有配置地址。
 */
export function resolveCurrentServerContext(input: CurrentServerInput): CurrentServerContext {
  if (!input.server) {
    return { server: null, status: 'none', instanceId: null, instance: null };
  }
  let server: string;
  try {
    server = normalizeServerUrl(input.server);
  } catch {
    return { server: input.server, status: 'unconfirmed', instanceId: null, instance: null };
  }
  const registry: ServerRegistry = {
    instances: input.servers ?? [],
    selectedInstanceId: input.selectedInstanceId ?? null,
    pendingAddresses: input.pendingAddresses ?? []
  };
  const binding = findServerInstanceByAddress(registry, server);
  if (binding) {
    return {
      server,
      status: 'confirmed',
      instanceId: binding.instance.instanceId,
      instance: binding.instance
    };
  }
  const pending = findPendingServerAddress(registry, server);
  if (registry.instances.length === 0 && !pending) {
    return { server, status: 'legacy', instanceId: null, instance: null };
  }
  return { server, status: 'unconfirmed', instanceId: null, instance: null };
}

export interface AddPendingServerAddressInput {
  url: string;
  now?: string;
  declaredInstanceId?: string | null;
}

/** 保存一个尚未确认身份的地址；已登记到实例的地址不会重复进入待确认列表。 */
export function addPendingServerAddress(
  registry: ServerRegistry,
  input: AddPendingServerAddressInput
): { registry: ServerRegistry; added: boolean } {
  const url = normalizeServerUrl(input.url);
  if (findServerInstanceByAddress(registry, url)) {
    return { registry, added: false };
  }
  const pendingAddresses = [...(registry.pendingAddresses ?? [])];
  const existing = pendingAddresses.find((address) => address.url === url);
  if (existing) {
    const declaredInstanceId = input.declaredInstanceId ?? existing.declaredInstanceId ?? null;
    return {
      registry: {
        ...registry,
        pendingAddresses: pendingAddresses.map((address) =>
          address.url === url ? { ...address, declaredInstanceId } : address
        )
      },
      added: false
    };
  }
  pendingAddresses.push({
    url,
    addedAt: input.now ?? new Date().toISOString(),
    ...(input.declaredInstanceId ? { declaredInstanceId: input.declaredInstanceId } : {})
  });
  return { registry: { ...registry, pendingAddresses }, added: true };
}

export function selectedServerInstance(registry: ServerRegistry): ServerInstanceRecord | null {
  return registry.selectedInstanceId
    ? findServerInstanceById(registry, registry.selectedInstanceId)
    : null;
}

/** 首选地址优先，其余已确认地址按登记顺序作为回退。 */
export function instanceAddressCandidates(instance: ServerInstanceRecord): string[] {
  const ordered = [
    instance.preferredAddress,
    ...instance.addresses.map((address) => address.url)
  ];
  return [...new Set(ordered.filter((url) => instance.addresses.some((entry) => entry.url === url)))];
}

export interface AddServerAddressInput {
  instanceId: string;
  url: string;
  /** true 表示本次操作把这个地址设为该实例的首选地址。 */
  select?: boolean;
  now?: string;
}

export interface AddServerAddressResult {
  registry: ServerRegistry;
  instance: ServerInstanceRecord;
  createdInstance: boolean;
  createdAddress: boolean;
}

/**
 * 把地址登记到实例。已登记地址返回 unchanged；地址已属于别的实例属于
 * fail-closed 场景，调用方必须显式移除旧登记后才能重新添加。
 */
export function addServerAddress(
  registry: ServerRegistry,
  input: AddServerAddressInput
): AddServerAddressResult {
  const url = normalizeServerUrl(input.url);
  if (!isValidInstanceId(input.instanceId)) {
    throw new Error(`Invalid ESL Server Instance ID: ${input.instanceId}`);
  }
  const existingAddress = findServerInstanceByAddress(registry, url);
  if (existingAddress && existingAddress.instance.instanceId !== input.instanceId) {
    throw new Error(
      `Address ${url} is already registered to ESL Server instance ${existingAddress.instance.instanceId}, ` +
        `but it now reports ${input.instanceId}. Refusing to rebind silently; ` +
        `remove the old registration first ("esl config server remove ${url}").`
    );
  }

  const createdAddress = !existingAddress;
  let createdInstance = false;
  const instances = registry.instances.map((instance) => ({ ...instance, addresses: [...instance.addresses] }));
  let instance = instances.find((candidate) => candidate.instanceId === input.instanceId);
  if (!instance) {
    createdInstance = true;
    instance = {
      instanceId: input.instanceId,
      addresses: [],
      preferredAddress: url
    };
    instances.push(instance);
  }
  if (!instance.addresses.some((address) => address.url === url)) {
    instance.addresses.push({ url, confirmedAt: input.now ?? new Date().toISOString() });
  }
  if (input.select || !instance.preferredAddress || !instance.addresses.some((a) => a.url === instance!.preferredAddress)) {
    instance.preferredAddress = url;
  }
  const selectedInstanceId = input.select ? input.instanceId : registry.selectedInstanceId;
  return {
    registry: {
      instances,
      selectedInstanceId: selectedInstanceId ?? (createdInstance && instances.length === 1 ? input.instanceId : registry.selectedInstanceId),
      pendingAddresses: (registry.pendingAddresses ?? []).filter((address) => address.url !== url)
    },
    instance,
    createdInstance,
    createdAddress
  };
}

export interface RemoveServerAddressResult {
  registry: ServerRegistry;
  removed: boolean;
  removedInstance: boolean;
  removedPending: boolean;
}

/** 移除地址只改本地登记；已安装技能、凭据和 Server 端数据都不动。 */
export function removeServerAddress(registry: ServerRegistry, url: string): RemoveServerAddressResult {
  const normalized = normalizeServerUrl(url);
  let removed = false;
  let removedInstance = false;
  const pendingAddresses = registry.pendingAddresses ?? [];
  const keptPending = pendingAddresses.filter((address) => address.url !== normalized);
  const removedPending = keptPending.length !== pendingAddresses.length;
  if (removedPending) {
    removed = true;
  }
  const instances: ServerInstanceRecord[] = [];
  for (const instance of registry.instances) {
    const addresses = instance.addresses.filter((address) => address.url !== normalized);
    if (addresses.length === instance.addresses.length) {
      instances.push(instance);
      continue;
    }
    removed = true;
    if (addresses.length === 0) {
      removedInstance = true;
      continue;
    }
    const preferredAddress = addresses.some((address) => address.url === instance.preferredAddress)
      ? instance.preferredAddress
      : addresses[0].url;
    instances.push({ ...instance, addresses, preferredAddress });
  }
  const selectedInstanceId =
    registry.selectedInstanceId && instances.some((instance) => instance.instanceId === registry.selectedInstanceId)
      ? registry.selectedInstanceId
      : null;
  return {
    registry: { instances, selectedInstanceId, pendingAddresses: keptPending },
    removed,
    removedInstance,
    removedPending
  };
}

export function removeServerInstance(
  registry: ServerRegistry,
  instanceId: string
): { registry: ServerRegistry; removed: ServerInstanceRecord | null } {
  const removed = findServerInstanceById(registry, instanceId);
  if (!removed) {
    return { registry, removed: null };
  }
  return {
    registry: {
      instances: registry.instances.filter((instance) => instance.instanceId !== instanceId),
      selectedInstanceId:
        registry.selectedInstanceId === instanceId ? null : registry.selectedInstanceId,
      pendingAddresses: registry.pendingAddresses ?? []
    },
    removed
  };
}

export function selectServerInstance(registry: ServerRegistry, instanceIdOrAddress: string): ServerRegistry {
  const key = instanceIdOrAddress.trim();
  const instance =
    findServerInstanceById(registry, key) ?? findServerInstanceByAddress(registry, key)?.instance ?? null;
  if (!instance) {
    throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
  }
  return { ...registry, selectedInstanceId: instance.instanceId };
}

/**
 * 读取 Server 匿名身份接口。该请求不带凭据，失败时抛出的错误由调用方决定
 * 是否降级（本地命令继续；需要来源的远端命令改成可行动错误）。
 */
export async function discoverServerIdentity(
  server: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<ServerIdentity> {
  const base = normalizeServerUrl(server);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${base}${SERVER_IDENTITY_PATH}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out discovering ESL Server instance identity from ${base}`);
    }
    throw new Error(
      `Unable to discover ESL Server instance identity from ${base}: ${(error as Error).message}. ` +
        'Check the Server address and network access, then retry.'
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(
      `Unable to discover ESL Server instance identity from ${base}: ${response.status} ${response.statusText}`
    );
  }
  let payload: { instanceId?: unknown; protocolVersion?: unknown };
  try {
    payload = (await response.json()) as { instanceId?: unknown; protocolVersion?: unknown };
  } catch {
    throw new Error(`ESL Server at ${base} returned an invalid instance identity response`);
  }
  if (!isValidInstanceId(payload.instanceId)) {
    throw new Error(
      `ESL Server at ${base} did not return a valid Instance ID; upgrade the Server to a version that supports instance identity`
    );
  }
  return {
    instanceId: payload.instanceId,
    protocolVersion:
      typeof payload.protocolVersion === 'number' ? payload.protocolVersion : SERVER_IDENTITY_PROTOCOL_VERSION
  };
}
