import type { PlatformSettingsRepository } from '../db/database.js';

// 匿名平台信息（ADR-0032）：部署模式与默认组织（ADR-0022）已废除，
// 仅暴露注册与拉人方式开关，供 CLI/Web 登录、注册与组织控制台自适应。
export function readPlatformInfo(repository: PlatformSettingsRepository): {
  registrationMode: 'open' | 'approval';
  memberAddMode: 'direct' | 'invite';
} {
  const registrationMode = repository.getSetting('registration_mode') === 'approval' ? 'approval' : 'open';
  const memberAddMode = repository.getSetting('member_add_mode') === 'invite' ? 'invite' : 'direct';
  return { registrationMode, memberAddMode };
}
