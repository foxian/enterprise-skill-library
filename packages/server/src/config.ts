import { DEFAULT_PASSWORD_MIN_LENGTH } from '@esl/core';

export interface ServerConfig {
  port: number;
  databasePath: string;
  giteaUrl: string;
  giteaAdminToken?: string;
  giteaAdminTokenFile?: string;
  giteaAdminUsername: string;
  giteaAdminPassword?: string;
  repoOwner: string;
  passwordMinLength: number;
  applicationEncryptionKey?: string;
  // When true the server seeds sample skill metadata at startup (ESL_AUTO_SEED).
  // Development environments opt in; production keeps the database clean.
  autoSeed: boolean;
  // 部署模式与默认组织声明(ADR-0022):单组织模式下必须声明默认组织名与
  // 组织管理员初始凭据,Bootstrap 直接 Provisioning,不走注册申请。
  deploymentMode: 'single' | 'multi';
  defaultOrg?: string;
  orgAdminPassword?: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const portRaw = env.PORT ?? '3000';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const giteaAdminToken = env.GITEA_ADMIN_TOKEN;
  const giteaAdminTokenFile = env.GITEA_ADMIN_TOKEN_FILE ?? '/bootstrap/gitea-admin-token';
  if (!giteaAdminToken && !giteaAdminTokenFile) {
    throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
  }
  const passwordMinLength = Number.parseInt(env.ESL_PASSWORD_MIN_LENGTH ?? String(DEFAULT_PASSWORD_MIN_LENGTH), 10);
  if (!Number.isInteger(passwordMinLength) || passwordMinLength < 1) {
    throw new Error(`Invalid ESL_PASSWORD_MIN_LENGTH: ${env.ESL_PASSWORD_MIN_LENGTH}`);
  }
  const autoSeed = env.ESL_AUTO_SEED === 'true' || env.ESL_AUTO_SEED === '1';

  const rawDeploymentMode = env.ESL_DEPLOYMENT_MODE;
  if (rawDeploymentMode !== undefined && rawDeploymentMode !== 'single' && rawDeploymentMode !== 'multi') {
    throw new Error(`Invalid ESL_DEPLOYMENT_MODE: ${rawDeploymentMode}`);
  }
  const deploymentMode = rawDeploymentMode === 'single' ? 'single' : 'multi';
  // 默认组织声明驱动 Bootstrap 开通(ADR-0022):单组织模式必须声明;多组织模式
  // 可选(声明了才在启动时开通并设为默认,未声明则空起步)。无论哪种模式,
  // 组织名与组织管理员初始凭据必须成对声明。
  let defaultOrg: string | undefined;
  let orgAdminPassword: string | undefined;
  if (deploymentMode === 'single') {
    defaultOrg = requireEnv(env, 'ESL_DEFAULT_ORG');
    orgAdminPassword = requireEnv(env, 'ESL_ORG_ADMIN_PASSWORD');
  } else if (env.ESL_DEFAULT_ORG !== undefined || env.ESL_ORG_ADMIN_PASSWORD !== undefined) {
    if (env.ESL_DEFAULT_ORG === undefined || env.ESL_ORG_ADMIN_PASSWORD === undefined) {
      throw new Error('ESL_DEFAULT_ORG and ESL_ORG_ADMIN_PASSWORD must be declared together');
    }
    defaultOrg = env.ESL_DEFAULT_ORG;
    orgAdminPassword = env.ESL_ORG_ADMIN_PASSWORD;
  }

  return {
    port,
    databasePath: requireEnv(env, 'DATABASE_PATH'),
    giteaUrl: requireEnv(env, 'GITEA_URL'),
    giteaAdminToken,
    giteaAdminTokenFile,
    giteaAdminUsername: env.GITEA_ADMIN_USERNAME ?? 'eslroot',
    giteaAdminPassword: env.GITEA_ADMIN_PASSWORD,
    repoOwner: 'esl-skills',
    passwordMinLength,
    autoSeed,
    deploymentMode,
    ...(defaultOrg !== undefined && orgAdminPassword !== undefined
      ? { defaultOrg, orgAdminPassword }
      : {}),
    ...(env.ESL_APPLICATION_ENCRYPTION_KEY
      ? { applicationEncryptionKey: env.ESL_APPLICATION_ENCRYPTION_KEY }
      : {})
  };
}
