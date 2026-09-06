import type { GiteaService } from './gitea.js';
import type { PlatformSettingsRepository, TenantOrganizationRepository } from '../db/database.js';
import type { DeploymentMode } from './platform-config.js';
import { initializeTenantOrganization } from './org-init.js';

// 默认组织部署 Bootstrap(ADR-0022):以环境变量声明(默认组织名 + 组织管理员初始
// 凭据)直接触发 Tenant Organization Provisioning,不走注册申请。单组织模式必填
// 声明,多组织模式可选(声明了才开通)。幂等:组织已开通(active)则跳过
// Provisioning;处于其它状态时拒绝静默接管,交由管理员处理。完成后把声明固化
// 为平台设置(部署模式 + 默认组织)。
export async function ensureDeclaredOrgBootstrap(deps: {
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
  tenantOrganizationRepository: TenantOrganizationRepository;
  orgName: string;
  adminPassword: string;
  deploymentMode: DeploymentMode;
}): Promise<void> {
  const {
    giteaService,
    platformSettingsRepository,
    tenantOrganizationRepository,
    orgName,
    adminPassword,
    deploymentMode
  } = deps;
  const tenant = tenantOrganizationRepository.get(orgName);
  if (tenant && tenant.status !== 'active') {
    throw new Error(
      `Default organization ${orgName} exists in state ${tenant.status}; resolve it before bootstrap`
    );
  }
  if (!tenant) {
    await initializeTenantOrganization(giteaService, orgName, adminPassword);
    tenantOrganizationRepository.create({ orgName, status: 'active' });
  }
  // 先写默认组织、再切部署模式:若中途失败,最坏停留在「多组织 + 默认组织」的
  // 安全态,而不是「单组织无默认组织」的死锁态。
  platformSettingsRepository.setSetting('default_org', orgName);
  platformSettingsRepository.setSetting('deployment_mode', deploymentMode);
}
