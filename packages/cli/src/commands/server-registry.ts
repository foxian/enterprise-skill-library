import {
  accountForInstance,
  addPendingServerAddress,
  addServerAddress,
  adoptAddressViewForInstance,
  clearCredentialsForInstance,
  discoverServerIdentity,
  findPendingServerAddress,
  findServerInstanceByAddress,
  findServerInstanceById,
  initializeLocalStore,
  instanceAddressCandidates,
  loadConfig,
  loadCredentials,
  normalizeServerUrl,
  removeServerAddress,
  removeServerInstance,
  saveConfig,
  saveCredentials,
  selectServerInstance,
  selectedServerInstance,
  tryNormalizeServerUrl,
  type EslConfig,
  type InstanceAccountSnapshot,
  type LocalStoreOptions,
  type ServerRegistry
} from '@esl/core';

export const IDENTITY_DISCOVERY_RETRY_MS = 60 * 60 * 1000;
export const STARTUP_IDENTITY_TIMEOUT_MS = 2_000;
export const CONFIG_IDENTITY_TIMEOUT_MS = 5_000;

export interface ServerRegistryCommandOptions extends LocalStoreOptions {
  customFetch?: typeof fetch;
  /** 非交互场景显式接受“新地址声明已登记实例 ID”的风险。 */
  acceptNewAddress?: boolean;
  /** 交互确认；返回 false 表示用户拒绝。 */
  confirmAddress?: (question: string) => Promise<boolean>;
}

export interface SetServerResult {
  server: string;
  instanceId: string | null;
  /** 地址首次绑定到已知实例时提示过安全风险。 */
  warned?: boolean;
  /** 身份发现失败，地址只保存为待确认状态。 */
  pending?: boolean;
}

export function registryOf(config: EslConfig): ServerRegistry {
  return {
    instances: config.servers ?? [],
    selectedInstanceId: config.selectedInstanceId ?? null,
    pendingAddresses: config.pendingServerAddresses ?? []
  };
}

function accountView(snapshot: InstanceAccountSnapshot | null): Partial<EslConfig> {
  return {
    username: snapshot?.username ?? null,
    email: snapshot?.email ?? null,
    organizations: snapshot?.organizations ?? null,
    locale: snapshot?.locale ?? null,
    legacyIdentity: snapshot?.legacyIdentity ?? false
  };
}

/**
 * 旧版单 Server 配置第一次确认实例时，把顶层凭据/账户快照迁移到该实例。
 * 仅在没有其他实例登记时执行；新地址永远不会继承旧实例凭据。
 */
async function migrateLegacyViewToInstance(
  instanceId: string,
  options: LocalStoreOptions
): Promise<void> {
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  if (!config) {
    return;
  }
  try {
    const credentials = await loadCredentials({ homeDir: options.homeDir });
    if (credentials.token && !credentials.instances?.[instanceId]) {
      await saveCredentials(
        { token: credentials.token, loginAt: credentials.loginAt, instanceId },
        { homeDir: options.homeDir }
      );
    }
  } catch {
    // 没有凭据文件时无需迁移。
  }
  if (!config.instanceAccounts?.[instanceId] && (config.username || config.email || config.organizations)) {
    await saveConfig(
      {
        instanceAccounts: {
          ...(config.instanceAccounts ?? {}),
          [instanceId]: {
            username: config.username ?? null,
            email: config.email ?? null,
            organizations: config.organizations ?? null,
            locale: config.locale ?? null,
            legacyIdentity: config.legacyIdentity ?? false
          }
        }
      },
      { homeDir: options.homeDir }
    );
  }
}

async function loadOrInitConfig(options: LocalStoreOptions): Promise<EslConfig> {
  try {
    return await loadConfig({ homeDir: options.homeDir });
  } catch {
    await initializeLocalStore({ homeDir: options.homeDir });
    return loadConfig({ homeDir: options.homeDir });
  }
}

async function persistRegistry(
  registry: ServerRegistry,
  options: LocalStoreOptions,
  extra: Partial<EslConfig> = {}
): Promise<void> {
  await saveConfig(
    {
      ...extra,
      servers: registry.instances,
      selectedInstanceId: registry.selectedInstanceId,
      pendingServerAddresses: registry.pendingAddresses ?? []
    },
    options
  );
}

export function impersonationWarning(url: string, instanceId: string): string {
  return (
    `Warning: ${url} claims to belong to the ESL Server instance ${instanceId}, ` +
    'which you already trust at another address. Instance IDs are not cryptographic ' +
    'proof, so this address could be impersonating that Server. Only continue if you ' +
    'control or trust this endpoint.'
  );
}

function validateServerUrl(value: string): void {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    throw new Error('Server URL must include http:// or https://, e.g. https://esl.example.com or http://localhost:4070.');
  }

  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('invalid HTTP(S) URL');
  } catch {
    throw new Error('Server URL must be a valid HTTP(S) URL, e.g. https://esl.example.com or http://localhost:4070.');
  }
}

/**
 * 登记并选中一个 Server 地址。发现失败时仍保存地址（本地命令可用），但不写入
 * 未经验证的 Instance ID；后续远程命令会重试发现并给出可行动错误。
 */
export async function executeSetServer(
  url: string,
  options: ServerRegistryCommandOptions = {}
): Promise<SetServerResult> {
  validateServerUrl(url);
  const server = normalizeServerUrl(url);
  const config = await loadOrInitConfig(options);
  let registry = registryOf(config);
  const wasLegacy = registry.instances.length === 0;

  let discovered: string | null = null;
  try {
    discovered = (await discoverServerIdentity(server, {
      fetchImpl: options.customFetch,
      timeoutMs: CONFIG_IDENTITY_TIMEOUT_MS
    })).instanceId;
  } catch {
    // 地址已登记过：离线切换仍可复用本地绑定，不必降级为待确认。
    const binding = findServerInstanceByAddress(registry, server);
    if (binding) {
      const next: ServerRegistry = {
        ...registry,
        selectedInstanceId: binding.instance.instanceId,
        pendingAddresses: (registry.pendingAddresses ?? []).filter(
          (address) => address.url !== server
        )
      };
      await persistRegistry(next, { homeDir: options.homeDir }, { server });
      return { server, instanceId: binding.instance.instanceId };
    }
    // 身份无法确认时仍保存地址，但标记为待确认并撤销当前选择：
    // 认证命令会在此地址上停止，不会使用旧实例凭据。
    const pending = addPendingServerAddress(registry, { url: server });
    const unconfirmed: ServerRegistry = { ...pending.registry, selectedInstanceId: null };
    await persistRegistry(unconfirmed, { homeDir: options.homeDir }, { server });
    return { server, instanceId: null, pending: true };
  }

  const binding = findServerInstanceByAddress(registry, server);
  if (binding && binding.instance.instanceId !== discovered) {
    throw new Error(
      `Address ${server} is registered to ESL Server instance ${binding.instance.instanceId}, ` +
        `but it now reports ${discovered}. Refusing to rebind silently. ` +
        `Remove the old registration first ("esl config server remove ${server}") and add it again.`
    );
  }

  const known = findServerInstanceById(registry, discovered);
  let warned = false;
  if (!binding && known) {
    warned = true;
    const question = impersonationWarning(server, discovered);
    let accepted = options.acceptNewAddress === true;
    if (!accepted && options.confirmAddress) {
      accepted = await options.confirmAddress(question);
    }
    if (!accepted) {
      throw new Error(
        `${question} Re-run with --accept-new-address after verifying the endpoint, ` +
          `or remove the existing registration if this is no longer the same Server.`,
      );
    }
  }

  const registration = addServerAddress(registry, {
    instanceId: discovered,
    url: server,
    select: true
  });
  registry = registration.registry;
  await persistRegistry(registry, { homeDir: options.homeDir }, { server });
  if (wasLegacy) {
    await migrateLegacyViewToInstance(discovered, options);
  }
  await adoptAddressViewForInstance(server, discovered, { homeDir: options.homeDir });
  return { server, instanceId: discovered, ...(warned ? { warned } : {}) };
}

/** 为已知实例登记一个备用地址；返回时不会切换当前选中实例。 */
export async function executeAddServerAddress(
  url: string,
  options: ServerRegistryCommandOptions & { instanceId?: string } = {}
): Promise<SetServerResult> {
  const server = normalizeServerUrl(url);
  const config = await loadOrInitConfig(options);
  const registry = registryOf(config);
  let discovered: string;
  try {
    discovered = (await discoverServerIdentity(server, {
      fetchImpl: options.customFetch,
      timeoutMs: CONFIG_IDENTITY_TIMEOUT_MS
    })).instanceId;
  } catch {
    // 离线也能提前登记地址；确认前不归属任何实例，也不会切换当前实例。
    const pending = addPendingServerAddress(registry, {
      url: server,
      declaredInstanceId: options.instanceId ?? null
    });
    await persistRegistry(pending.registry, { homeDir: options.homeDir });
    return { server, instanceId: null, pending: true };
  }
  if (options.instanceId && options.instanceId !== discovered) {
    throw new Error(
      `Address ${server} reports ESL Server instance ${discovered}, not ${options.instanceId}; refusing to register it.`
    );
  }
  const pending = findPendingServerAddress(registry, server);
  if (pending?.declaredInstanceId && pending.declaredInstanceId !== discovered) {
    throw new Error(
      `Address ${server} was saved with declared Instance ID ${pending.declaredInstanceId}, ` +
        `but it now reports ${discovered}; refusing to confirm it silently. Remove the pending ` +
        `registration first if this change is expected.`
    );
  }
  const binding = findServerInstanceByAddress(registry, server);
  if (binding) {
    if (binding.instance.instanceId !== discovered) {
      throw new Error(
        `Address ${server} is registered to ESL Server instance ${binding.instance.instanceId}, ` +
          `but it now reports ${discovered}. Refusing to rebind silently; remove the old registration first.`
      );
    }
    // 已确认地址：不再重复提示，但仍已完成上面的原实例校验。
    return { server, instanceId: discovered };
  }
  const known = findServerInstanceById(registry, discovered);
  if (known) {
    const question = impersonationWarning(server, discovered);
    let accepted = options.acceptNewAddress === true;
    if (!accepted && options.confirmAddress) {
      accepted = await options.confirmAddress(question);
    }
    if (!accepted) {
      throw new Error(
        `${question} Re-run with --accept-new-address after verifying the endpoint.`
      );
    }
  }
  const registration = addServerAddress(registry, { instanceId: discovered, url: server });
  // 显式 add 只登记备用地址，不改变当前选择（即使这是第一个实例）。
  const next: ServerRegistry = {
    ...registration.registry,
    selectedInstanceId: registry.selectedInstanceId
  };
  await persistRegistry(next, { homeDir: options.homeDir });
  await adoptAddressViewForInstance(server, discovered, { homeDir: options.homeDir });
  return { server, instanceId: discovered, ...(known ? { warned: true } : {}) };
}

export interface ServerListResult {
  instances: Array<{
    instanceId: string;
    selected: boolean;
    preferredAddress: string;
    addresses: Array<{ url: string; preferred: boolean; current: boolean; confirmedAt: string }>;
  }>;
  pendingAddresses: Array<{ url: string; current: boolean; addedAt: string; declaredInstanceId?: string | null }>;
}

/** 只读列表：绝不初始化本地存储、写配置/凭据或触发身份发现。 */
export async function executeListServers(options: LocalStoreOptions = {}): Promise<ServerListResult> {
  let config: EslConfig | null = null;
  try {
    config = await loadConfig({ homeDir: options.homeDir });
  } catch {
    config = null;
  }
  if (!config) {
    return { instances: [], pendingAddresses: [] };
  }
  const registry = registryOf(config);
  const current = config.server ? tryNormalizeServerUrl(config.server) : null;
  return {
    instances: registry.instances.map((instance) => ({
      instanceId: instance.instanceId,
      selected: registry.selectedInstanceId === instance.instanceId,
      preferredAddress: instance.preferredAddress,
      addresses: instance.addresses.map((address) => ({
        url: address.url,
        preferred: address.url === instance.preferredAddress,
        current: address.url === current,
        confirmedAt: address.confirmedAt
      }))
    })),
    pendingAddresses: (registry.pendingAddresses ?? []).map((address) => ({
      url: address.url,
      current: address.url === current,
      addedAt: address.addedAt,
      ...(address.declaredInstanceId ? { declaredInstanceId: address.declaredInstanceId } : {})
    }))
  };
}

/**
 * 选择实例。地址是连接入口：按地址选择时把该地址设为实例首选地址；按
 * Instance ID 选择时使用既有首选地址。待确认地址也可切换，但身份保持未知，
 * 认证命令会在发送凭据前停止。
 */
export async function executeUseServer(
  instanceIdOrAddress: string,
  options: LocalStoreOptions = {}
): Promise<{ instanceId: string | null; server: string; pending?: boolean }> {
  const config = await loadOrInitConfig(options);
  const key = instanceIdOrAddress.trim();
  const registry = registryOf(config);
  const pending = findPendingServerAddress(registry, tryNormalizeServerUrl(key) ?? key);
  if (pending) {
    await persistRegistry(
      { ...registry, selectedInstanceId: null },
      { homeDir: options.homeDir },
      { server: pending.url, ...accountView(null) }
    );
    return { instanceId: null, server: pending.url, pending: true };
  }

  const binding = findServerBinding(registry, key);
  let next = selectServerInstance(registry, key);
  let targetAddress: string;
  if (binding) {
    targetAddress = binding.address.url;
    next = {
      ...next,
      instances: next.instances.map((instance) =>
        instance.instanceId === binding.instance.instanceId
          ? { ...instance, preferredAddress: targetAddress }
          : instance
      )
    };
  } else {
    const instance = selectedServerInstance(next);
    if (!instance) {
      throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
    }
    targetAddress = instance.preferredAddress;
  }
  const instance = selectedServerInstance(next);
  if (!instance) {
    throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
  }
  await persistRegistry(next, { homeDir: options.homeDir }, {
    server: targetAddress,
    ...accountView(accountForInstance(config, instance.instanceId))
  });
  return { instanceId: instance.instanceId, server: targetAddress };
}

function findServerBinding(registry: ServerRegistry, key: string) {
  const normalized = tryNormalizeServerUrl(key);
  return normalized ? findServerInstanceByAddress(registry, normalized) : null;
}

/**
 * 移除地址或整个实例登记。只删除本地地址/凭据视图，已安装技能与 Server 端数据
 * 保持不变；用户若要重新添加同一地址，会走一次显式确认流程。
 */
export interface RemoveServerResult {
  removed: boolean;
  removedInstance: boolean;
  removedAddresses: string[];
  /** 删除当前地址后自动回退到的同实例地址；没有可用地址时为 null。 */
  fallbackAddress: string | null;
  /** 本次连带清理凭据的实例。 */
  clearedInstanceIds: string[];
}

export async function executeRemoveServer(
  instanceIdOrAddress: string,
  options: LocalStoreOptions = {}
): Promise<RemoveServerResult> {
  const config = await loadOrInitConfig(options);
  const registry = registryOf(config);
  const key = instanceIdOrAddress.trim();
  const currentAddress = config.server ? tryNormalizeServerUrl(config.server) : null;
  const instance = findServerInstanceById(registry, key);

  if (instance) {
    const next = removeServerInstance(registry, instance.instanceId).registry;
    const currentBelongs = instance.addresses.some((address) => address.url === currentAddress);
    const nextSelected = selectedServerInstance(next);
    const nextServer = currentBelongs ? null : nextSelected?.preferredAddress ?? config.server;
    const nextBinding = nextServer ? findServerInstanceByAddress(next, nextServer) : null;
    await persistRegistry(next, { homeDir: options.homeDir }, {
      server: nextServer,
      ...accountView(
        nextBinding ? accountForInstance(config, nextBinding.instance.instanceId) : null
      )
    });
    await clearCredentialsForInstance(instance.instanceId, { homeDir: options.homeDir }).catch(
      () => undefined
    );
    await removeAccountSnapshot(instance.instanceId, options);
    return {
      removed: true,
      removedInstance: true,
      removedAddresses: instance.addresses.map((address) => address.url),
      fallbackAddress: null,
      clearedInstanceIds: [instance.instanceId]
    };
  }

  const url = normalizeServerUrl(key);
  const binding = findServerInstanceByAddress(registry, url);
  const result = removeServerAddress(registry, url);
  if (!result.removed) {
    throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
  }

  const clearedInstanceIds: string[] = [];
  let fallbackAddress: string | null = null;
  let nextServer: string | null = config.server;

  if (result.removedPending) {
    if (currentAddress === url) {
      nextServer = null;
    }
  } else if (result.removedInstance && binding) {
    clearedInstanceIds.push(binding.instance.instanceId);
    await clearCredentialsForInstance(binding.instance.instanceId, { homeDir: options.homeDir }).catch(
      () => undefined
    );
    await removeAccountSnapshot(binding.instance.instanceId, options);
    if (currentAddress === url) {
      nextServer = null;
    }
  } else if (binding) {
    // 同一实例仍有其他已确认地址时保留凭据；当前地址被删则在本实例内回退。
    const remaining = result.registry.instances.find(
      (candidate) => candidate.instanceId === binding.instance.instanceId
    );
    if (currentAddress === url) {
      fallbackAddress = remaining?.preferredAddress ?? null;
      nextServer = fallbackAddress;
    }
  }

  const nextBinding = nextServer
    ? findServerInstanceByAddress(result.registry, nextServer)
    : null;
  await persistRegistry(result.registry, { homeDir: options.homeDir }, {
    server: nextServer,
    ...accountView(
      nextBinding ? accountForInstance(config, nextBinding.instance.instanceId) : null
    )
  });
  return {
    removed: true,
    removedInstance: result.removedInstance,
    removedAddresses: [url],
    fallbackAddress,
    clearedInstanceIds
  };
}

async function removeAccountSnapshot(instanceId: string, options: LocalStoreOptions): Promise<void> {
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  if (!config?.instanceAccounts?.[instanceId]) {
    return;
  }
  const instanceAccounts = { ...config.instanceAccounts };
  delete instanceAccounts[instanceId];
  await saveConfig({ instanceAccounts }, { homeDir: options.homeDir });
}

/**
 * CLI 启动时的尽力身份发现：仅有配置地址且本地没有 Instance ID 缓存时尝试；
 * 失败只记录退避时间，不阻止本地命令执行。远程命令会自行重试。
 */
export async function runStartupIdentityDiscovery(
  options: LocalStoreOptions & { customFetch?: typeof fetch; now?: Date } = {}
): Promise<{ discovered: boolean; instanceId: string | null }> {
  let config: EslConfig;
  try {
    config = await loadConfig({ homeDir: options.homeDir });
  } catch {
    return { discovered: false, instanceId: null };
  }
  if (!config.server) {
    return { discovered: false, instanceId: null };
  }
  const registry = registryOf(config);
  const currentBinding = findServerInstanceByAddress(
    registry,
    normalizeServerUrl(config.server)
  );
  // 只有当前地址已经登记才无需发现；selectedInstanceId 单独存在时不能盖过
  // 当前地址的待确认状态。
  if (currentBinding) {
    return { discovered: false, instanceId: currentBinding.instance.instanceId };
  }
  const wasLegacy = registry.instances.length === 0;
  const now = options.now ?? new Date();
  if (config.identityDiscoveryFailedAt) {
    const failedAt = Date.parse(config.identityDiscoveryFailedAt);
    if (!Number.isNaN(failedAt) && now.getTime() - failedAt < IDENTITY_DISCOVERY_RETRY_MS) {
      return { discovered: false, instanceId: null };
    }
  }
  try {
    const identity = await discoverServerIdentity(config.server, {
      fetchImpl: options.customFetch,
      timeoutMs: STARTUP_IDENTITY_TIMEOUT_MS
    });
    const binding = findServerInstanceByAddress(registry, normalizeServerUrl(config.server));
    if (binding && binding.instance.instanceId !== identity.instanceId) {
      // 已登记地址返回不同 ID：启动期不改绑、不覆盖，保留原记录给远程命令报错。
      return { discovered: false, instanceId: binding.instance.instanceId };
    }
    if (!binding && findServerInstanceById(registry, identity.instanceId)) {
      // 新地址声明已知实例：启动期不做隐式信任决策，留给用户显式
      // `esl config server add/confirm` 完成安全确认。
      return { discovered: false, instanceId: identity.instanceId };
    }
    const pending = findPendingServerAddress(registry, normalizeServerUrl(config.server));
    if (pending?.declaredInstanceId && pending.declaredInstanceId !== identity.instanceId) {
      // 待确认地址声明过别的 Instance ID：不自动确认，保留给用户处理。
      return { discovered: false, instanceId: null };
    }
    const registration = addServerAddress(registry, {
      instanceId: identity.instanceId,
      url: config.server,
      select: true
    });
    await persistRegistry(registration.registry, { homeDir: options.homeDir }, {
      server: normalizeServerUrl(config.server),
      identityDiscoveryFailedAt: null
    });
    if (wasLegacy) {
      await migrateLegacyViewToInstance(identity.instanceId, options);
    }
    await adoptAddressViewForInstance(config.server, identity.instanceId, options);
    return { discovered: true, instanceId: identity.instanceId };
  } catch {
    await saveConfig(
      { identityDiscoveryFailedAt: now.toISOString() },
      { homeDir: options.homeDir }
    ).catch(() => undefined);
    return { discovered: false, instanceId: null };
  }
}

/**
 * 解析实例的可用地址：首选地址优先，发现失败时尝试其余已确认地址。调用方负责
 * 区分“本地命令可继续”与“远程命令必须报错”。
 */
export async function resolveInstanceAddress(
  instanceId: string,
  options: LocalStoreOptions & { customFetch?: typeof fetch } = {}
): Promise<{ server: string; instanceId: string } | null> {
  const config = await loadOrInitConfig(options);
  const registry = registryOf(config);
  const instance = findServerInstanceById(registry, instanceId);
  if (!instance) {
    return null;
  }
  for (const address of instanceAddressCandidates(instance)) {
    try {
      const identity = await discoverServerIdentity(address, { fetchImpl: options.customFetch });
      if (identity.instanceId === instanceId) {
        return { server: address, instanceId };
      }
    } catch {
      // 尝试同实例的下一个已确认地址。
    }
  }
  return null;
}

export { selectedServerInstance };
