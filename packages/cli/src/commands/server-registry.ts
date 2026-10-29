import {
  addServerAddress,
  discoverServerIdentity,
  findServerInstanceByAddress,
  findServerInstanceById,
  initializeLocalStore,
  instanceAddressCandidates,
  loadConfig,
  normalizeServerUrl,
  removeServerAddress,
  saveConfig,
  selectServerInstance,
  selectedServerInstance,
  type EslConfig,
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
}

export function registryOf(config: EslConfig): ServerRegistry {
  return {
    instances: config.servers ?? [],
    selectedInstanceId: config.selectedInstanceId ?? null
  };
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
      selectedInstanceId: registry.selectedInstanceId
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

/**
 * 登记并选中一个 Server 地址。发现失败时仍保存地址（本地命令可用），但不写入
 * 未经验证的 Instance ID；后续远程命令会重试发现并给出可行动错误。
 */
export async function executeSetServer(
  url: string,
  options: ServerRegistryCommandOptions = {}
): Promise<SetServerResult> {
  const server = normalizeServerUrl(url);
  const config = await loadOrInitConfig(options);
  let registry = registryOf(config);

  let discovered: string | null = null;
  try {
    discovered = (await discoverServerIdentity(server, {
      fetchImpl: options.customFetch,
      timeoutMs: CONFIG_IDENTITY_TIMEOUT_MS
    })).instanceId;
  } catch (error) {
    // 地址先保存：旧单 Server 迁移/离线环境下不能丢用户配置。
    await saveConfig({ server }, { homeDir: options.homeDir });
    return { server, instanceId: null };
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
  const discovered = (await discoverServerIdentity(server, {
    fetchImpl: options.customFetch,
    timeoutMs: CONFIG_IDENTITY_TIMEOUT_MS
  })).instanceId;
  if (options.instanceId && options.instanceId !== discovered) {
    throw new Error(
      `Address ${server} reports ESL Server instance ${discovered}, not ${options.instanceId}; refusing to register it.`
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
  await persistRegistry(registration.registry, { homeDir: options.homeDir });
  return { server, instanceId: discovered, ...(known ? { warned: true } : {}) };
}

export interface ServerListResult {
  instances: Array<{
    instanceId: string;
    selected: boolean;
    preferredAddress: string;
    addresses: Array<{ url: string; preferred: boolean; confirmedAt: string }>;
  }>;
}

export async function executeListServers(options: LocalStoreOptions = {}): Promise<ServerListResult> {
  const config = await loadOrInitConfig(options);
  const registry = registryOf(config);
  return {
    instances: registry.instances.map((instance) => ({
      instanceId: instance.instanceId,
      selected: registry.selectedInstanceId === instance.instanceId,
      preferredAddress: instance.preferredAddress,
      addresses: instance.addresses.map((address) => ({
        url: address.url,
        preferred: address.url === instance.preferredAddress,
        confirmedAt: address.confirmedAt
      }))
    }))
  };
}

/** 选择实例；server 记录其首选地址，保持旧命令的单一 Server 视图。 */
export async function executeUseServer(
  instanceIdOrAddress: string,
  options: LocalStoreOptions = {}
): Promise<{ instanceId: string; server: string }> {
  const config = await loadOrInitConfig(options);
  const registry = selectServerInstance(registryOf(config), instanceIdOrAddress);
  const instance = selectedServerInstance(registry);
  if (!instance) {
    throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
  }
  await persistRegistry(registry, { homeDir: options.homeDir }, { server: instance.preferredAddress });
  return { instanceId: instance.instanceId, server: instance.preferredAddress };
}

/**
 * 移除地址或整个实例登记。只删除本地地址/凭据视图，已安装技能与 Server 端数据
 * 保持不变；用户若要重新添加同一地址，会走一次显式确认流程。
 */
export async function executeRemoveServer(
  instanceIdOrAddress: string,
  options: LocalStoreOptions = {}
): Promise<{ removed: boolean; removedInstance: boolean; removedAddresses: string[] }> {
  const config = await loadOrInitConfig(options);
  const registry = registryOf(config);
  const key = instanceIdOrAddress.trim();
  const instance = findServerInstanceById(registry, key);
  if (instance) {
    const instances = registry.instances.filter((candidate) => candidate.instanceId !== instance.instanceId);
    const next: ServerRegistry = {
      instances,
      selectedInstanceId:
        registry.selectedInstanceId === instance.instanceId ? null : registry.selectedInstanceId
    };
    const nextSelected = selectedServerInstance(next);
    await persistRegistry(next, { homeDir: options.homeDir }, {
      ...(nextSelected ? { server: nextSelected.preferredAddress } : {})
    });
    return {
      removed: true,
      removedInstance: true,
      removedAddresses: instance.addresses.map((address) => address.url)
    };
  }
  const url = normalizeServerUrl(key);
  const result = removeServerAddress(registry, url);
  if (!result.removed) {
    throw new Error(`Unknown ESL Server instance or address: ${instanceIdOrAddress}`);
  }
  const selected = selectedServerInstance(result.registry);
  await persistRegistry(result.registry, { homeDir: options.homeDir }, {
    ...(selected ? { server: selected.preferredAddress } : {})
  });
  return { removed: true, removedInstance: result.removedInstance, removedAddresses: [url] };
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
  if (registry.selectedInstanceId && findServerInstanceById(registry, registry.selectedInstanceId)) {
    return { discovered: false, instanceId: registry.selectedInstanceId };
  }
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
    const registration = addServerAddress(registry, {
      instanceId: identity.instanceId,
      url: config.server,
      select: true
    });
    await persistRegistry(registration.registry, { homeDir: options.homeDir }, {
      server: normalizeServerUrl(config.server),
      identityDiscoveryFailedAt: null
    });
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
