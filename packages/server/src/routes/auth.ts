import { apiError } from '../errors.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  giteaUserEmail,
  normalizeSkillUserEmail,
  validatePassword,
  validateSkillUserEmail
} from '@esl/core';
import type {
  AdminRepository,
  PlatformSettingsRepository,
  UserRegistrationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { deriveOrganizations } from '../services/organization-membership.js';
import { SUPPORTED_LOCALES } from '@esl/i18n';
import { logEvent } from '../logging.js';
import { findSkillUserEmailConflict } from '../services/skill-user-email.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
  userRegistrationRepository: UserRegistrationRepository;
  passwordMinLength?: number;
}

// 全局身份登录（ADR-0032）：账号无 <org>_ 前缀，登录只提交 username + password；
// 所属组织列表与逐组织身份由 Gitea 成员关系派生（ADR-0038）。组织内没有角色——
// 服务端不派生任何全局角色，由客户端按 isPlatformAdmin 与逐组织的
// identity / isOwnerMember 分别选视角与渲染治理入口。
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repository, giteaService } = options;

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = (request.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send(apiError('usernameAndPasswordAreRequired'));
    }
    if (username === giteaService.adminUsername) {
      return reply.status(403).send(apiError('platformAdministratorsSignInFromTheAdminConsole'));
    }

    const token = await giteaService.loginUser(username, password);
    if (!token) {
      return unauthorized(reply, request, username);
    }
    try {
      repository.registerIssuedToken(username, token);
    } catch {
      return unauthorized(reply, request, username);
    }

    return {
      token,
      username,
      locale: repository.getLocale(username),
      organizations: await deriveOrganizations(giteaService, username)
    };
  });

  // 管理后台专用登录：平台管理员与普通用户都收，平台角色只有这两个
  // （ADR-0033）。响应只声明两件事实——是不是平台管理员、在每个组织是什么
  // 身份（三档，ADR-0038）——由客户端据此选视角与渲染治理入口。
  app.post('/api/console/login', async (request, reply) => {
    const { username, password } = (request.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send(apiError('usernameAndPasswordAreRequired'));
    }

    const token = await giteaService.loginUser(username, password);
    if (!token) {
      return unauthorized(reply, request, username);
    }
    try {
      repository.registerIssuedToken(username, token);
    } catch {
      return unauthorized(reply, request, username);
    }

    const isPlatformAdmin = username === giteaService.adminUsername;
    return {
      token,
      username,
      isPlatformAdmin,
      locale: repository.getLocale(username),
      // 平台管理员不属于任何组织（ADR-0033），不参与组织治理故不派生隶属关系
      organizations: isPlatformAdmin ? [] : await deriveOrganizations(giteaService, username)
    };
  });

  // 账户语言偏好（ADR-0044）：登录用户（含平台管理员）读取与更新自己的 locale。
  app.get('/api/account/preferences', async (request, reply) => {
    const username = resolveRepositoryUsername(request, reply, repository);
    if (!username) return;
    return { locale: repository.getLocale(username) };
  });

  app.put('/api/account/preferences', async (request, reply) => {
    const username = resolveRepositoryUsername(request, reply, repository);
    if (!username) return;

    const { locale } = (request.body ?? {}) as { locale?: string | null };
    if (locale !== null && locale !== undefined && !(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
      return reply.status(400).send(apiError('unsupportedLocale', { locale }));
    }
    repository.setLocale(username, locale ?? null);
    return { locale: locale ?? null };
  });

  app.get('/api/account/profile', async (request, reply) => {
    const username = await resolveTokenUsername(request, reply, giteaService);
    if (!username) return;
    const user = await giteaService.getUser(username);
    if (!user) {
      return reply.status(404).send(apiError('userDoesNotExist', { username }));
    }
    const email = normalizeSkillUserEmail(user.email);
    return {
      username,
      email,
      emailPendingCompletion: email === giteaUserEmail(username)
    };
  });

  app.put('/api/account/email', async (request, reply) => {
    const { currentPassword, email: rawEmail } = (request.body ?? {}) as {
      currentPassword?: string;
      email?: string;
    };
    if (!currentPassword || typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return reply.status(400).send(apiError('currentPasswordAndEmailAreRequired'));
    }
    const username = await resolveTokenUsername(request, reply, giteaService);
    if (!username) return;

    const valid = await giteaService.validateUserPassword(username, currentPassword);
    if (!valid) {
      return reply.status(401).send(apiError('unauthorizedCurrentPasswordIsIncorrect'));
    }
    const validation = validateSkillUserEmail(rawEmail);
    if (!validation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: validation.errors.join(', ') }));
    }
    const email = validation.data;
    const conflict = await findSkillUserEmailConflict(
      giteaService,
      options.userRegistrationRepository,
      email,
      { exceptUsername: username }
    );
    if (conflict === 'pending-registration') {
      return reply.status(409).send(apiError('emailHasPendingRegistration', { email }));
    }
    if (conflict === 'active-user') {
      return reply.status(409).send(apiError('emailAlreadyTaken', { email }));
    }

    await giteaService.changeUserEmail(username, email);
    return {
      username,
      email,
      emailPendingCompletion: false
    };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const { oldPassword, newPassword } = request.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) {
      return reply.status(400).send(apiError('currentAndNewPasswordsAreRequired'));
    }
    const passwordValidation = validatePassword(newPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: passwordValidation.errors.join(', ') }));
    }

    const username = await resolveTokenUsername(request, reply, giteaService);
    if (!username) return;

    const valid = await giteaService.validateUserPassword(username, oldPassword);
    if (!valid) {
      logEvent(
        request.log,
        'warn',
        {
          event: 'auth.password-change',
          outcome: 'failed',
          actorUsername: username,
          errorCode: 'unauthorizedCurrentPasswordIsIncorrect'
        },
        'Password change rejected'
      );
      return reply.status(401).send(apiError('unauthorizedCurrentPasswordIsIncorrect'));
    }

    await giteaService.changeUserPassword(username, newPassword);
    return { passwordChanged: true };
  });
}

async function resolveTokenUsername(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send(apiError('unauthorizedMissingToken'));
    return null;
  }

  const token = authorization.replace('token ', '').trim();
  const user = await giteaService.validateToken(token);
  if (!user) {
    reply.status(401).send(apiError('unauthorizedInvalidToken'));
    return null;
  }
  return user.username;
}

// 认证失败是安全事件（ADR-0045）：记 warn 供发现潜在攻击或误配置，但不升级
// 成服务端异常。只记尝试的用户名，绝不记密码或 token。
function unauthorized(reply: FastifyReply, request: FastifyRequest, username: string) {
  logEvent(
    request.log,
    'warn',
    {
      event: 'auth.login',
      outcome: 'failed',
      actorUsername: username,
      errorCode: 'unauthorizedInvalidCredentials'
    },
    'Login rejected'
  );
  return reply.status(401).send(apiError('unauthorizedInvalidCredentials'));
}

function resolveRepositoryUsername(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AdminRepository
): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send(apiError('unauthorizedMissingToken'));
    return null;
  }
  const user = repository.validateUserToken(authorization.replace('token ', '').trim());
  if (!user) {
    reply.status(401).send(apiError('unauthorizedInvalidToken'));
    return null;
  }
  return user.username;
}
