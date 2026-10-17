import { resolvePasswordMinLength } from '@esl/core';
import type { PlatformSettingsRepository } from '../db/database.js';

// 匿名平台信息（ADR-0032）：部署模式与默认组织（ADR-0022）已废除，
// 仅暴露平台开关，供 CLI/Web 登录、注册与个人控制台自适应。
// orgRegistrationMode 必须下发：组织创建入口已并入个人控制台（ADR-0035），
// 客户端要据此决定是"即时创建"还是"提交申请"，不能靠试错请求去发现。
// passwordMinLength 必须下发：注册页据它展示密码规则并做本地预校验（#146），
// 否则客户端只能硬编码默认值，在自定义 ESL_PASSWORD_MIN_LENGTH 的实例上与
// 服务端判定不一致。
export function readPlatformInfo(
  repository: PlatformSettingsRepository,
  passwordMinLength?: number
): {
  registrationMode: 'open' | 'approval';
  memberAddMode: 'direct' | 'invite';
  orgRegistrationMode: 'auto' | 'manual';
  passwordMinLength: number;
} {
  const registrationMode = repository.getSetting('registration_mode') === 'approval' ? 'approval' : 'open';
  const memberAddMode = repository.getSetting('member_add_mode') === 'invite' ? 'invite' : 'direct';
  const orgRegistrationMode =
    repository.getSetting('org_registration_mode') === 'manual' ? 'manual' : 'auto';
  return {
    registrationMode,
    memberAddMode,
    orgRegistrationMode,
    passwordMinLength: resolvePasswordMinLength(passwordMinLength)
  };
}
