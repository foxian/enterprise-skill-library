import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeServerUrl, resolveCurrentServerContext } from '../server/instance-identity.js';
import type { ServerInstanceRecord } from '../server/instance-identity.js';

export interface LocalStorePaths {
  root: string;
  configJson: string;
  credentialsJson: string;
  cacheDir: string;
  skillsDir: string;
}

export interface ProjectStorePaths {
  root: string;
  skillsDir: string;
}

export interface LocalStoreOptions {
  homeDir?: string;
}

export function resolveLocalStorePaths(options: LocalStoreOptions = {}): LocalStorePaths {
  const homeDir = options.homeDir ?? os.homedir();
  const root = path.join(homeDir, '.eslib');
  return {
    root,
    configJson: path.join(root, 'config.json'),
    credentialsJson: path.join(root, 'credentials.json'),
    cacheDir: path.join(root, 'cache'),
    skillsDir: path.join(root, 'skills')
  };
}

export function resolveProjectStorePaths(projectRoot: string): ProjectStorePaths {
  const root = path.join(projectRoot, '.eslib');
  return {
    root,
    skillsDir: path.join(root, 'skills')
  };
}

async function writeJsonIfMissing(filePath: string, value: unknown, mode?: number): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
    if (mode !== undefined) {
      // 若文件已存在，writeFile 不会改变其权限；这里只对新建路径生效。
      await fs.chmod(filePath, mode);
    }
  }
}

export async function initializeLocalStore(options: LocalStoreOptions = {}): Promise<LocalStorePaths> {
  const paths = resolveLocalStorePaths(options);

  await fs.mkdir(paths.cacheDir, { recursive: true });
  await fs.mkdir(paths.skillsDir, { recursive: true });
  await writeJsonIfMissing(paths.configJson, {
    server: null,
    username: null,
    email: null,
    organizations: null,
    tools: []
  });
  await writeJsonIfMissing(paths.credentialsJson, {
    token: null,
    loginAt: null
  }, 0o600);

  return paths;
}

// 组织隶属关系（ADR-0032 / ADR-0036）：登录时由服务端按 Gitea 成员关系派生并随
// 登录响应下发，CLI 侧只做展示（whoami/status）。组织内没有角色——`identity` 是
// 由常设团队成员身份推导出的三档身份。
export interface OrganizationMembership {
  org: string;
  identity: 'ordinary' | 'managing' | 'owner';
  /** 便捷判据：是否所有者成员。 */
  isOwnerMember: boolean;
}

export interface EslCredentials {
  token: string | null;
  loginAt: string | null;
  /** 顶层 token 最近一次登录所用的地址；用于地址确认后提升到实例凭据。 */
  address?: string | null;
  /** 按 Instance ID 隔离的凭据；顶层字段仅作为最近一次登录的兼容视图。 */
  instances?: Record<string, { token: string | null; loginAt: string | null }>;
}

/**
 * 读取指定实例的凭据。已确认实例绝不回退到顶层遗留凭据：顶层 token 可能属于
 * 另一个实例，回退会把旧实例的用户/凭据带到新地址。instanceId 为空时才读取
 * 旧版顶层凭据（仅用于尚未登记实例的 legacy 配置）。
 */
export function credentialsForInstance(
  credentials: EslCredentials,
  instanceId: string | null | undefined
): { token: string | null; loginAt: string | null } {
  if (instanceId) {
    return credentials.instances?.[instanceId] ?? { token: null, loginAt: null };
  }
  return { token: credentials.token, loginAt: credentials.loginAt };
}

export interface InstanceAccountSnapshot {
  username: string | null;
  email: string | null;
  organizations: OrganizationMembership[] | null;
  locale?: string | null;
  legacyIdentity?: boolean;
}

export interface ConfigIdentity {
  legacyIdentity?: boolean;
}

export interface EslConfig extends ConfigIdentity {
  server: string | null;
  username: string | null;
  /**
   * 登录时刻从服务端取回的用户邮箱快照（/api/account/profile）。不是凭据，
   * 与 username 同级存放；改邮箱后需重新登录才会刷新。token-file 离线登录
   * 拿不到，置为 null。存量账号的合成邮箱（user@local.esl）原样保存。
   */
  email?: string | null;
  /** 账户语言偏好（ADR-0044）；null 表示未主动选择。 */
  locale?: string | null;
  organizations: OrganizationMembership[] | null;
  tools: string[];
  /** 多 Server 实例登记（ADR-0071）；旧配置迁移前为空。 */
  servers?: ServerInstanceRecord[];
  /**
   * 当前选中实例的兼容视图。当前连接地址的实例绑定优先；它不是登录状态的
   * 判断依据，也不能盖过地址所属实例。
   */
  selectedInstanceId?: string | null;
  /** 已保存但尚未确认 Instance ID 的地址。 */
  pendingServerAddresses?: Array<{
    url: string;
    addedAt: string;
    declaredInstanceId?: string | null;
  }>;
  /**
   * 按 Instance ID 隔离的账户快照。whoami 等展示只读当前实例的条目，
   * 顶层 username/email/organizations 仅作为最近一次登录的兼容视图保留。
   */
  instanceAccounts?: Record<string, InstanceAccountSnapshot>;
  /** 启动期身份发现失败的时间，用于避免离线时每条命令都等待网络超时。 */
  identityDiscoveryFailedAt?: string | null;
  /** 本机常用工具的选中次数（ADR-0054）：按工具累计，只存这台机器。 */
  toolSelectionCounts?: Record<string, number>;
  cliUpdate?: {
    enabled?: boolean;
    lastCheckedAt?: string;
    lastNotifiedVersion?: string;
    lastNotifiedAt?: string;
  };
}

/** 从完整配置解析当前连接地址的身份，避免各调用方重复拼装字段。 */
export function serverContextOfConfig(config: EslConfig): ReturnType<typeof resolveCurrentServerContext> {
  return resolveCurrentServerContext({
    server: config.server,
    servers: config.servers ?? [],
    selectedInstanceId: config.selectedInstanceId ?? null,
    pendingAddresses: config.pendingServerAddresses ?? []
  });
}

/** 只读取指定实例的账户快照；确认实例没有快照时返回 null，不回退到其他实例。 */
export function accountForInstance(
  config: EslConfig,
  instanceId: string | null | undefined
): InstanceAccountSnapshot | null {
  if (!instanceId) {
    return null;
  }
  return config.instanceAccounts?.[instanceId] ?? null;
}

/**
 * 当前连接地址对应的账户快照。confirmed 只读该实例条目；legacy 读取旧版
 * 顶层字段；unconfirmed / none 不展示任何账户身份。
 */
export function currentAccountSnapshot(config: EslConfig): InstanceAccountSnapshot | null {
  const context = serverContextOfConfig(config);
  if (context.status === 'confirmed' && context.instanceId) {
    return accountForInstance(config, context.instanceId);
  }
  const hasRegistry =
    (config.servers?.length ?? 0) > 0 || (config.pendingServerAddresses?.length ?? 0) > 0;
  if (context.status === 'legacy' || (context.status === 'none' && !hasRegistry)) {
    return {
      username: config.username,
      email: config.email ?? null,
      organizations: config.organizations,
      locale: config.locale ?? null,
      ...(config.legacyIdentity !== undefined ? { legacyIdentity: config.legacyIdentity } : {})
    };
  }
  return null;
}

export async function loadConfig(options: LocalStoreOptions = {}): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const raw = await fs.readFile(paths.configJson, 'utf8');
  const parsed = JSON.parse(raw) as EslConfig & { org?: unknown; role?: unknown };
  // 旧版配置带 org/role（ADR-0032 已废除）：读取侧剥离并打标记。
  const staleMemberships = (parsed as { organizations?: unknown }).organizations;
  const staleMembershipShape =
    Array.isArray(staleMemberships) &&
    staleMemberships.some(
      (membership) =>
        typeof membership === 'object' &&
        membership !== null &&
        ('role' in membership || 'isOrgManager' in membership)
    );
  const legacyIdentity = 'org' in parsed || 'role' in parsed || staleMembershipShape;
  const { org: _legacyOrg, role: _legacyRole, ...rest } = parsed;
  if (rest.organizations === undefined) {
    rest.organizations = null;
  }
  return legacyIdentity ? { ...rest, legacyIdentity: true } : rest;
}

export async function saveConfig(
  config: Partial<EslConfig>,
  options: LocalStoreOptions = {}
): Promise<EslConfig> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadConfig(options);
  const updated: EslConfig = {
    ...current,
    ...config,
    organizations: config.organizations ?? current.organizations,
    tools: config.tools ?? current.tools,
    servers: config.servers ?? current.servers,
    selectedInstanceId:
      config.selectedInstanceId === undefined ? current.selectedInstanceId : config.selectedInstanceId,
    pendingServerAddresses:
      config.pendingServerAddresses === undefined
        ? current.pendingServerAddresses
        : config.pendingServerAddresses,
    instanceAccounts:
      config.instanceAccounts === undefined ? current.instanceAccounts : config.instanceAccounts
  };
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(paths.configJson, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

export async function loadCredentials(options: LocalStoreOptions = {}): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  return JSON.parse(await fs.readFile(paths.credentialsJson, 'utf8')) as EslCredentials;
}

export async function saveCredentials(
  credentials: Partial<EslCredentials> & { instanceId?: string | null },
  options: LocalStoreOptions = {}
): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  const current = await loadCredentials(options);
  const token = credentials.token === undefined ? current.token : credentials.token;
  const loginAt = credentials.loginAt === undefined ? current.loginAt : credentials.loginAt;
  const address = credentials.address === undefined ? current.address : credentials.address;
  const instances = { ...(current.instances ?? {}) };
  if (credentials.instanceId) {
    instances[credentials.instanceId] = { token, loginAt };
  } else if (credentials.instances) {
    Object.assign(instances, credentials.instances);
  }
  const updated: EslCredentials = {
    token,
    loginAt,
    ...(address ? { address } : {}),
    ...(Object.keys(instances).length > 0 ? { instances } : {})
  };
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(paths.credentialsJson, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  // writeFile 的 mode 只在创建文件时生效；initializeLocalStore 可能先以默认权限
  // 建过该文件，重写时必须显式收紧，保证 token 文件始终 owner-only。
  await fs.chmod(paths.credentialsJson, 0o600);
  return updated;
}

/**
 * 只清理指定实例的凭据，保留其他实例。若顶层兼容视图正是该实例的凭据，
 * 同步清空；否则顶层视图保持原样（它代表最近一次登录，不一定是当前实例）。
 */
export async function clearCredentialsForInstance(
  instanceId: string,
  options: LocalStoreOptions = {}
): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  let current: EslCredentials;
  try {
    current = await loadCredentials(options);
  } catch {
    current = { token: null, loginAt: null };
  }
  const instances = { ...(current.instances ?? {}) };
  const removed = instances[instanceId];
  delete instances[instanceId];
  const clearTopLevel = Boolean(removed && removed.token && removed.token === current.token);
  const updated: EslCredentials = {
    token: clearTopLevel ? null : current.token,
    loginAt: clearTopLevel ? null : current.loginAt,
    ...(!clearTopLevel && current.address ? { address: current.address } : {}),
    ...(Object.keys(instances).length > 0 ? { instances } : {})
  };
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(paths.credentialsJson, `${JSON.stringify(updated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.chmod(paths.credentialsJson, 0o600);
  return updated;
}

/**
 * 地址确认归属某个实例后，把“最近一次登录仍停留在顶层”的凭据与账户快照
 * 提升到该实例。只有顶层凭据记录的登录地址正是这个地址时才迁移，避免把
 * 另一个实例的登录错误归到新确认的实例。
 */
export async function adoptAddressViewForInstance(
  address: string,
  instanceId: string,
  options: LocalStoreOptions = {}
): Promise<void> {
  let normalized: string;
  try {
    normalized = normalizeServerUrl(address);
  } catch {
    return;
  }
  const credentials = await loadCredentials(options).catch(() => null);
  if (!credentials?.address || normalizeServerUrl(credentials.address) !== normalized) {
    return;
  }
  if (credentials.token && !credentials.instances?.[instanceId]) {
    await saveCredentials(
      { token: credentials.token, loginAt: credentials.loginAt, instanceId },
      options
    );
  }
  const config = await loadConfig(options).catch(() => null);
  if (
    !config ||
    config.instanceAccounts?.[instanceId] ||
    !(config.username || config.email || config.organizations)
  ) {
    return;
  }
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
    options
  );
}

export async function clearCredentials(options: LocalStoreOptions = {}): Promise<EslCredentials> {
  const paths = resolveLocalStorePaths(options);
  await fs.mkdir(paths.root, { recursive: true });
  const cleared: EslCredentials = { token: null, loginAt: null };
  await fs.writeFile(paths.credentialsJson, `${JSON.stringify(cleared, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.chmod(paths.credentialsJson, 0o600);
  return cleared;
}
