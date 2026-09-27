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
  EmailActionRepository,
  PlatformSettingsRepository,
  UserRegistrationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { deriveOrganizations } from '../services/organization-membership.js';
import { SUPPORTED_LOCALES } from '@esl/i18n';
import { logEvent } from '../logging.js';
import { findSkillUserEmailConflict } from '../services/skill-user-email.js';
import {
  createActionToken,
  decryptSecret,
  EMAIL_ACTION_TTL_MS,
  hashActionToken,
  resolveRequestOrigin,
  type Mailer
} from '../services/mailer.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
  userRegistrationRepository: UserRegistrationRepository;
  passwordMinLength?: number;
  emailActionRepository: EmailActionRepository;
  mailer: Mailer;
  emailActionSecret: string;
}

// 全局身份登录（ADR-0032）：账号无 <org>_ 前缀，登录只提交 username + password；
// 所属组织列表与逐组织身份由 Gitea 成员关系派生（ADR-0038）。组织内没有角色——
// 服务端不派生任何全局角色，由客户端按 isPlatformAdmin 与逐组织的
// identity / isOwnerMember 分别选视角与渲染治理入口。
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repository, giteaService, platformSettingsRepository, emailActionRepository, mailer } = options;

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = (request.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send(apiError('usernameAndPasswordAreRequired'));
    }
    if (username === giteaService.adminUsername) {
      return reply.status(403).send(apiError('platformAdministratorsSignInFromTheAdminConsole'));
    }

    if (emailActionRepository.getPending('register', username)) {
      return reply.status(403).send(apiError('emailVerificationRequiredBeforeLogin'));
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

    if (username !== giteaService.adminUsername && emailActionRepository.getPending('register', username)) {
      return reply.status(403).send(apiError('emailVerificationRequiredBeforeLogin'));
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
      emailPendingCompletion: email === giteaUserEmail(username),
      emailPendingVerification: Boolean(emailActionRepository.getPending('email_change', username))
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
      { exceptUsername: username, emailActionRepository }
    );
    if (conflict === 'pending-registration') {
      return reply.status(409).send(apiError('emailHasPendingRegistration', { email }));
    }
    if (conflict === 'active-user') {
      return reply.status(409).send(apiError('emailAlreadyTaken', { email }));
    }

    const currentUser = await giteaService.getUser(username);
    if (!currentUser) {
      return reply.status(404).send(apiError('userDoesNotExist', { username }));
    }
    if (platformSettingsRepository.getSetting('email_verification') === 'on') {
      if (!mailer.isConfigured()) {
        return reply.status(409).send(apiError('outboundEmailIsNotConfigured'));
      }
      const token = createActionToken();
      emailActionRepository.create({
        purpose: 'email_change',
        username,
        email,
        previousEmail: normalizeSkillUserEmail(currentUser.email),
        tokenHash: hashActionToken(token),
        expiresAt: new Date(Date.now() + EMAIL_ACTION_TTL_MS).toISOString()
      });
      await mailer.send({
        to: email,
        subject: 'Verify your new ESL account email',
        text: `Open this link to confirm your new ESL account email: ${resolveRequestOrigin(request)}/admin/verify-email?token=${encodeURIComponent(token)}`
      });
      return {
        username,
        email: normalizeSkillUserEmail(currentUser.email),
        emailPendingCompletion: normalizeSkillUserEmail(currentUser.email) === giteaUserEmail(username),
        emailPendingVerification: true
      };
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

  app.post('/api/auth/verify-email', async (request, reply) => {
    const { token } = (request.body ?? {}) as { token?: string };
    if (!token) {
      return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
    }
    const action = emailActionRepository.getValid(hashActionToken(token));
    if (!action || (action.purpose !== 'register' && action.purpose !== 'email_change')) {
      return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
    }
    if (!emailActionRepository.claim(action.id)) {
      return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
    }
    if (action.purpose === 'register') {
      try {
        if (!action.passwordCiphertext) {
          emailActionRepository.consume(action.id);
          return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
        }
        if (await giteaService.getUser(action.username)) {
          emailActionRepository.consume(action.id);
          return reply.status(409).send(apiError('usernameAlreadyTaken', { username: action.username }));
        }
        const password = decryptSecret(action.passwordCiphertext, options.emailActionSecret);
        await giteaService.createUser(action.username, password, { email: action.email });
        if (!emailActionRepository.consume(action.id)) {
          return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
        }
        return { status: 'verified', username: action.username, email: action.email };
      } catch (error) {
        emailActionRepository.release(action.id);
        throw error;
      }
    }

    try {
      const user = await giteaService.getUser(action.username);
      if (!user) {
        emailActionRepository.consume(action.id);
        return reply.status(404).send(apiError('userDoesNotExist', { username: action.username }));
      }
      const conflict = await findSkillUserEmailConflict(
        giteaService,
        options.userRegistrationRepository,
        action.email,
        { exceptUsername: action.username, emailActionRepository }
      );
      if (conflict === 'active-user' || conflict === 'pending-registration') {
        emailActionRepository.consume(action.id);
        return reply.status(409).send(apiError('emailAlreadyTaken', { email: action.email }));
      }
      await giteaService.changeUserEmail(action.username, action.email);
      if (!emailActionRepository.consume(action.id)) {
        return reply.status(400).send(apiError('emailVerificationLinkIsInvalidOrExpired'));
      }
      return { status: 'verified', username: action.username, email: action.email };
    } catch (error) {
      emailActionRepository.release(action.id);
      throw error;
    }
  });

  app.post('/api/auth/verify-email/resend', async (request, reply) => {
    const { username: rawUsername, purpose = 'register' } = (request.body ?? {}) as {
      username?: string;
      purpose?: string;
    };
    if (purpose !== 'register' && purpose !== 'email_change') {
      return reply.status(400).send(apiError('usernameIsRequired'));
    }
    let username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (purpose === 'email_change') {
      const actor = await resolveTokenUsername(request, reply, giteaService);
      if (!actor) return;
      username = actor;
    } else if (!username) {
      return reply.status(400).send(apiError('usernameIsRequired'));
    }
    const action = emailActionRepository.getPending(purpose, username);
    if (!action) return reply.status(202).send({ status: 'accepted' });
    if (!mailer.isConfigured()) return reply.status(409).send(apiError('outboundEmailIsNotConfigured'));
    const token = createActionToken();
    emailActionRepository.create({
      purpose: action.purpose,
      username: action.username,
      email: action.email,
      previousEmail: action.previousEmail ?? undefined,
      passwordCiphertext: action.passwordCiphertext ?? undefined,
      tokenHash: hashActionToken(token),
      expiresAt: new Date(Date.now() + EMAIL_ACTION_TTL_MS).toISOString()
    });
    await mailer.send({
      to: action.email,
      subject: action.purpose === 'register' ? 'Verify your ESL account email' : 'Verify your new ESL account email',
      text: `Open this link to continue: ${resolveRequestOrigin(request)}/admin/verify-email?token=${encodeURIComponent(token)}`
    });
    return reply.status(202).send({ status: 'accepted' });
  });

  app.post('/api/auth/password-reset/request', async (request, reply) => {
    const { username: rawUsername } = (request.body ?? {}) as { username?: string };
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (!username) return reply.status(400).send(apiError('usernameIsRequired'));
    const genericResponse = { status: 'accepted', message: apiError('passwordResetRequestReceived').message };
    if (username === giteaService.adminUsername || !mailer.isConfigured()) return reply.status(202).send(genericResponse);
    const user = await giteaService.getUser(username);
    if (!user || normalizeSkillUserEmail(user.email) === giteaUserEmail(username)) {
      return reply.status(202).send(genericResponse);
    }
    const managedUser = (await giteaService.listUsers()).find((candidate) => candidate.username === username);
    if (managedUser?.prohibit_login) return reply.status(202).send(genericResponse);
    const token = createActionToken();
    emailActionRepository.create({
      purpose: 'password_reset',
      username,
      email: normalizeSkillUserEmail(user.email),
      tokenHash: hashActionToken(token),
      expiresAt: new Date(Date.now() + EMAIL_ACTION_TTL_MS).toISOString()
    });
    await mailer.send({
      to: normalizeSkillUserEmail(user.email),
      subject: 'Reset your ESL account password',
      text: `Open this link to reset your ESL account password: ${resolveRequestOrigin(request)}/admin/reset-password?token=${encodeURIComponent(token)}`
    });
    return reply.status(202).send(genericResponse);
  });

  app.post('/api/auth/password-reset', async (request, reply) => {
    const { token, newPassword } = (request.body ?? {}) as { token?: string; newPassword?: string };
    if (!token || !newPassword) return reply.status(400).send(apiError('newPasswordIsRequired'));
    const passwordValidation = validatePassword(newPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: passwordValidation.errors.join(', ') }));
    }
    const action = emailActionRepository.getValid(hashActionToken(token), 'password_reset');
    if (!action) return reply.status(400).send(apiError('passwordResetLinkIsInvalidOrExpired'));
    if (action.username === giteaService.adminUsername) {
      return reply.status(403).send(apiError('passwordResetEmailIsNotAvailable'));
    }
    const user = await giteaService.getUser(action.username);
    const managedUser = user ? (await giteaService.listUsers()).find((candidate) => candidate.username === action.username) : null;
    if (!user || managedUser?.prohibit_login || normalizeSkillUserEmail(user.email) !== action.email) {
      return reply.status(409).send(apiError('passwordResetEmailIsNotAvailable'));
    }
    if (!emailActionRepository.claim(action.id)) {
      return reply.status(400).send(apiError('passwordResetLinkIsInvalidOrExpired'));
    }
    try {
      await giteaService.changeUserPassword(action.username, newPassword, { mustChangePassword: false });
      await giteaService.revokeUserTokens(action.username);
      repository.revokeUserTokens(action.username);
      if (!emailActionRepository.consume(action.id)) {
        return reply.status(400).send(apiError('passwordResetLinkIsInvalidOrExpired'));
      }
      return { passwordReset: true };
    } catch (error) {
      emailActionRepository.release(action.id);
      throw error;
    }
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
