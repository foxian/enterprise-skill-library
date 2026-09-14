import type { PlatformSettingsRepository } from '../db/database.js';

// 匿名平台信息（ADR-0032）：部署模式与默认组织（ADR-0022）已废除，
// 仅暴露三个平台开关，供 CLI/Web 登录、注册与个人控制台自适应。
// orgRegistrationMode 必须下发：组织创建入口已并入个人控制台（ADR-0035），
// 客户端要据此决定是"即时创建"还是"提交申请"，不能靠试错请求去发现。
export function readPlatformInfo(repository: PlatformSettingsRepository): {
  registrationMode: 'open' | 'approval';
  memberAddMode: 'direct' | 'invite';
  orgRegistrationMode: 'auto' | 'manual';
} {
  const registrationMode = repository.getSetting('registration_mode') === 'approval' ? 'approval' : 'open';
  const memberAddMode = repository.getSetting('member_add_mode') === 'invite' ? 'invite' : 'direct';
  const orgRegistrationMode =
    repository.getSetting('org_registration_mode') === 'manual' ? 'manual' : 'auto';
  return { registrationMode, memberAddMode, orgRegistrationMode };
}
