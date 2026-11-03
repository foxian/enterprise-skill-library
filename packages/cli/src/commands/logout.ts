import {
  clearCredentials,
  clearCredentialsForInstance,
  credentialsForInstance,
  loadConfig,
  loadCredentials,
  resolveCurrentServerContext,
  saveConfig,
  type LocalStoreOptions,
  type ServerIdentityStatus
} from '@esl/core';

export interface LogoutResult {
  hadCredentials: boolean;
  identityStatus: ServerIdentityStatus;
  /** 身份未知时拒绝清理，避免错误删除其他实例凭据。 */
  blocked: boolean;
  instanceId: string | null;
}

export async function executeLogout(options: LocalStoreOptions = {}): Promise<LogoutResult> {
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  const context = resolveCurrentServerContext({
    server: config?.server ?? null,
    servers: config?.servers ?? [],
    selectedInstanceId: config?.selectedInstanceId ?? null,
    pendingAddresses: config?.pendingServerAddresses ?? []
  });

  // 身份未知（或没有可确定地址但已登记多实例）时不能猜测要清哪个实例。
  if (
    context.status === 'unconfirmed' ||
    (context.status === 'none' && (config?.servers?.length ?? 0) > 0)
  ) {
    return {
      hadCredentials: false,
      identityStatus: context.status,
      blocked: true,
      instanceId: context.instanceId
    };
  }

  if (context.status === 'confirmed' && context.instanceId) {
    let hadCredentials = false;
    try {
      const credentials = await loadCredentials({ homeDir: options.homeDir });
      hadCredentials = Boolean(credentialsForInstance(credentials, context.instanceId).token);
    } catch {
      hadCredentials = false;
    }
    if (hadCredentials) {
      await clearCredentialsForInstance(context.instanceId, { homeDir: options.homeDir });
    }
    if (config) {
      const instanceAccounts = { ...(config.instanceAccounts ?? {}) };
      delete instanceAccounts[context.instanceId];
      await saveConfig(
        {
          instanceAccounts,
          // 顶层字段是兼容视图：当前实例登出后不能继续显示它的账户。
          username: null,
          email: null,
          organizations: null
        },
        { homeDir: options.homeDir }
      );
    }
    return {
      hadCredentials,
      identityStatus: context.status,
      blocked: false,
      instanceId: context.instanceId
    };
  }

  let hadCredentials = false;
  try {
    const credentials = await loadCredentials({ homeDir: options.homeDir });
    hadCredentials = Boolean(credentials.token);
  } catch {
    hadCredentials = false;
  }
  await clearCredentials({ homeDir: options.homeDir });
  return {
    hadCredentials,
    identityStatus: context.status,
    blocked: false,
    instanceId: context.instanceId
  };
}

export function formatLogout(result: LogoutResult): string {
  if (result.blocked) {
    return (
      'The current ESL Server identity is not confirmed; no credentials were cleared. ' +
      'Confirm or remove the address with "esl config server list" first.'
    );
  }
  return result.hadCredentials
    ? 'Logged out. Local credentials cleared for the current ESL Server.'
    : 'Not logged in; no credentials to clear.';
}
