import type { PlatformSettingsRepository } from '../db/database.js';

// 匿名平台信息（ADR-0032）：部署模式与默认组织（ADR-0022）已废除，
// 仅暴露注册相关开关供 CLI/Web 登录与注册页自适应。
export function readPlatformInfo(repository: PlatformSettingsRepository): {
  registrationMode: 'open' | 'approval';
} {
  const registrationMode = repository.getSetting('registration_mode') === 'approval' ? 'approval' : 'open';
  return { registrationMode };
}
