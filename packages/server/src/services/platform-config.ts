import type { PlatformSettingsRepository } from '../db/database.js';

// 部署模式与默认组织的统一读取面(ADR-0022)。默认组织是可独立设置的配置:
// 多组织模式下可空,单组织模式下必须设置且是唯一可登录的组织。
export type DeploymentMode = 'single' | 'multi';

export function readDeploymentMode(repository: PlatformSettingsRepository): DeploymentMode {
  const mode = repository.getSetting('deployment_mode');
  return mode === 'single' ? 'single' : 'multi';
}

export function readDefaultOrg(repository: PlatformSettingsRepository): string | null {
  const org = repository.getSetting('default_org');
  return org ? org : null;
}

export function readPlatformInfo(repository: PlatformSettingsRepository): {
  mode: DeploymentMode;
  defaultOrg: string | null;
} {
  return { mode: readDeploymentMode(repository), defaultOrg: readDefaultOrg(repository) };
}

// 从 Organization-scoped Account Name(形如 <org>_<username>)解析组织名。
// 组织名与成员用户名都不允许下划线,因此首段即组织名、可唯一解析(ADR-0020)。
// 平台管理员账号(如 eslroot)无下划线,不属于任何组织,返回 null。
export function resolveUsernameOrg(username: string): string | null {
  const idx = username.indexOf('_');
  if (idx <= 0 || idx === username.length - 1) return null;
  return username.slice(0, idx);
}
