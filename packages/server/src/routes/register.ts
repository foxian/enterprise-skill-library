import type { FastifyInstance } from 'fastify';
import { RESERVED_SCOPE_NAMES, validateMemberUsername, validatePassword } from '@esl/core';
import type { OrgApplicationRepository, UserRegistrationRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { PlatformSettingsRepository } from '../db/database.js';

export interface RegisterRouteOptions {
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
  userRegistrationRepository: UserRegistrationRepository;
  orgApplicationRepository: OrgApplicationRepository;
  passwordMinLength?: number;
}

// 用户自助注册（ADR-0032）：全局账号 + 个人命名空间。注册模式为平台设置
// registration_mode = open（注册即用）| approval（账号先建后禁用，审批激活，
// 拒绝删除账号并释放名字）。
export function registerUserRoutes(app: FastifyInstance, options: RegisterRouteOptions): void {
  const { giteaService, platformSettingsRepository, userRegistrationRepository, orgApplicationRepository } = options;

  app.post('/api/auth/register', async (request, reply) => {
    const { username: rawUsername, password } = (request.body ?? {}) as { username?: string; password?: string };
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }
    if (username === giteaService.adminUsername) {
      return reply.status(409).send({ error: `Username is already taken: ${username}` });
    }

    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }

    const passwordValidation = validatePassword(password, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }

    // 扁平命名池查重（先到先得）：待审注册 / 待审组织申请 / 用户名 /
    // 组织名（Gitea 同一命名空间），任何一类占用都在提交时当场拒绝。
    if (userRegistrationRepository.getByUsername(username)?.status === 'pending') {
      return reply.status(409).send({ error: `Username has a pending registration: ${username}` });
    }
    if (orgApplicationRepository.getApplication(username)?.status === 'pending') {
      return reply.status(409).send({ error: `Username is claimed by a pending organization application: ${username}` });
    }
    let existing: unknown = null;
    try {
      existing = await giteaService.getUser(username);
    } catch {
      existing = null;
    }
    if (existing) {
      return reply.status(409).send({ error: `Username is already taken: ${username}` });
    }

    const mode = platformSettingsRepository.getSetting('registration_mode') ?? 'open';
    if (mode === 'approval') {
      // 账号先建后禁用：名字即刻占用，审批只是解禁；拒绝时删除账号释放名字。
      await giteaService.createUser(username, password);
      await giteaService.disableUser(username);
      const registration = userRegistrationRepository.create(username);
      return reply.status(202).send({
        status: 'pending',
        username: registration.username,
        registrationId: registration.id
      });
    }

    await giteaService.createUser(username, password);
    return reply.status(201).send({ status: 'registered', username });
  });
}
