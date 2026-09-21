import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  giteaUserEmail,
  normalizeSkillUserEmail,
  validateMemberUsername,
  validatePassword,
  validateSkillUserEmail
} from '@esl/core';
import { apiError } from '../errors.js';
import type {
  AdminRepository,
  OrgApplicationRepository,
  PlatformSettingsRepository,
  UserRegistrationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { findSkillUserEmailConflict } from '../services/skill-user-email.js';
import { requireSuperAdministrator } from './org-admin.js';

export interface UserAdminRouteOptions {
  adminRepository: AdminRepository;
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  userRegistrationRepository: UserRegistrationRepository;
  passwordMinLength?: number;
}

export function registerUserAdminRoutes(app: FastifyInstance, options: UserAdminRouteOptions): void {
  const { giteaService } = options;

  app.get('/api/admin/users', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;

    const query = request.query as { search?: string; status?: string };
    if (query.status !== undefined && query.status !== 'enabled' && query.status !== 'disabled') {
      return reply.status(400).send(apiError('userStatusMustBeEnabledOrDisabled'));
    }
    const search = query.search?.trim();
    const users = await giteaService.listUsers();
    const pendingUsernames = new Set(
      options.userRegistrationRepository.listByStatus('pending').map((registration) => registration.username)
    );
    return users
      .filter(
        (user) =>
          user.username !== giteaService.adminUsername && !pendingUsernames.has(user.username)
      )
      .filter((user) => {
        if (query.status === 'enabled' && user.prohibit_login) return false;
        if (query.status === 'disabled' && !user.prohibit_login) return false;
        if (!search) return true;
        const keyword = search.toLowerCase();
        return (
          user.username.toLowerCase().includes(keyword) ||
          normalizeSkillUserEmail(user.email).includes(keyword)
        );
      })
      .map((user) => {
        const email = normalizeSkillUserEmail(user.email);
        return {
          username: user.username,
          email,
          enabled: !user.prohibit_login,
          emailPendingCompletion: email === giteaUserEmail(user.username)
        };
      });
  });

  app.post('/api/admin/users', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;

    const { username: rawUsername, password, email: rawEmail } = (request.body ?? {}) as {
      username?: string;
      password?: string;
      email?: string;
    };
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (!username || !password) {
      return reply.status(400).send(apiError('usernameAndPasswordAreRequired'));
    }
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return reply.status(400).send(apiError('emailIsRequired'));
    }
    if (username === giteaService.adminUsername) {
      return reply.status(409).send(apiError('usernameAlreadyTaken', { username }));
    }
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: usernameValidation.errors.join(', ') }));
    }
    const passwordValidation = validatePassword(password, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: passwordValidation.errors.join(', ') }));
    }
    const emailValidation = validateSkillUserEmail(rawEmail);
    if (!emailValidation.success) {
      return reply.status(400).send(apiError('validationFailed', { detail: emailValidation.errors.join(', ') }));
    }
    const email = emailValidation.data;

    if (options.userRegistrationRepository.getByUsername(username)?.status === 'pending') {
      return reply.status(409).send(apiError('usernameHasPendingRegistration', { username }));
    }
    if (options.orgApplicationRepository.getApplication(username)?.status === 'pending') {
      return reply.status(409).send(apiError('usernameClaimedByPendingOrganizationApplication', { username }));
    }
    if (await giteaService.getUser(username)) {
      return reply.status(409).send(apiError('usernameAlreadyTaken', { username }));
    }
    const emailConflict = await findSkillUserEmailConflict(
      giteaService,
      options.userRegistrationRepository,
      email
    );
    if (emailConflict === 'pending-registration') {
      return reply.status(409).send(apiError('emailHasPendingRegistration', { email }));
    }
    if (emailConflict === 'active-user') {
      return reply.status(409).send(apiError('emailAlreadyTaken', { email }));
    }

    const mustChangePassword =
      (options.platformSettingsRepository.getSetting('admin_provisioned_password_change_policy') ?? 'force') ===
      'force';
    await giteaService.createUser(username, password, { email, mustChangePassword });
    return reply.status(201).send({
      username,
      email,
      enabled: true,
      emailPendingCompletion: false
    });
  });

  app.post('/api/admin/users/:username/disable', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const user = await getUserForManagement(
      username,
      reply,
      giteaService,
      options.adminRepository,
      options.userRegistrationRepository
    );
    if (!user) return;

    await giteaService.disableUser(username);
    options.adminRepository.disableUser(username);
    await giteaService.revokeUserTokens(username);
    return toUserView(user, false);
  });

  app.post('/api/admin/users/:username/enable', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const user = await getUserForManagement(
      username,
      reply,
      giteaService,
      options.adminRepository,
      options.userRegistrationRepository
    );
    if (!user) return;

    await giteaService.enableUser(username);
    options.adminRepository.enableUser(username);
    return toUserView(user, true);
  });

  app.put('/api/admin/users/:username/email', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const user = await getUserForManagement(
      username,
      reply,
      giteaService,
      options.adminRepository,
      options.userRegistrationRepository
    );
    if (!user) return;
    const { email: rawEmail } = (request.body ?? {}) as { email?: string };
    if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return reply.status(400).send(apiError('emailIsRequired'));
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
    return toUserView(
      { ...user, email },
      'prohibit_login' in user ? !user.prohibit_login : true
    );
  });
}

async function getUserForManagement(
  username: string,
  reply: FastifyReply,
  giteaService: GiteaService,
  adminRepository: AdminRepository,
  userRegistrationRepository: UserRegistrationRepository
) {
  if (username === giteaService.adminUsername) {
    reply.status(403).send(apiError('forbiddenSuperAdministratorAccountCannotBeManaged'));
    return null;
  }
  if (userRegistrationRepository.getByUsername(username)?.status === 'pending') {
    reply.status(409).send(apiError('pendingRegistrationMustBeProcessedFromUserRegistrationApproval'));
    return null;
  }
  const user =
    (await giteaService.listUsers()).find((candidate) => candidate.username === username) ??
    (await giteaService.getUser(username));
  if (!user) {
    reply.status(404).send(apiError('userDoesNotExist', { username }));
    return null;
  }
  adminRepository.createUser(username);
  return user;
}

function toUserView(
  user: { username: string; email: string; prohibit_login?: boolean },
  enabled: boolean
) {
  const email = normalizeSkillUserEmail(user.email);
  return {
    username: user.username,
    email,
    enabled,
    emailPendingCompletion: email === giteaUserEmail(user.username)
  };
}
