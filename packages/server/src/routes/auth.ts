import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatePassword } from '@esl/core';
import type { AdminRepository, PlatformSettingsRepository } from '../db/database.js';
import type { GiteaService, GiteaOrg, GiteaUser } from '../services/gitea.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
  passwordMinLength?: number;
}

export interface OrganizationMembership {
  org: string;
  role: 'org-admin' | 'member';
}

// 全局身份登录（ADR-0032）：账号无 <org>_ 前缀，登录只提交 username + password；
// 角色与所属组织列表由 Gitea 成员关系派生（Owners 团队成员 = Organization Admin）。
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repository, giteaService } = options;

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = (request.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }
    if (username === giteaService.adminUsername) {
      return reply.status(403).send({ error: 'Platform administrators sign in from the Admin Console' });
    }

    const token = await giteaService.loginUser(username, password);
    if (!token) {
      return unauthorized(reply);
    }
    try {
      repository.registerIssuedToken(username, token);
    } catch {
      return unauthorized(reply);
    }

    return { token, username, organizations: await deriveOrganizations(giteaService, username) };
  });

  // 管理后台专用登录：三类角色都收。超级管理员（eslroot）结构不变；
  // 其余账号按 Gitea 成员关系派生角色（任一组织的 Owners 成员即 org-admin）。
  app.post('/api/console/login', async (request, reply) => {
    const { username, password } = (request.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    const token = await giteaService.loginUser(username, password);
    if (!token) {
      return unauthorized(reply);
    }
    try {
      repository.registerIssuedToken(username, token);
    } catch {
      return unauthorized(reply);
    }

    if (username === giteaService.adminUsername) {
      return { token, username, role: 'super' as const, organizations: [] };
    }
    const organizations = await deriveOrganizations(giteaService, username);
    const role = organizations.some((membership) => membership.role === 'org-admin')
      ? ('org-admin' as const)
      : ('member' as const);
    return { token, username, role, organizations };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const { oldPassword, newPassword } = request.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) {
      return reply.status(400).send({ error: 'Current and new passwords are required' });
    }
    const passwordValidation = validatePassword(newPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }

    const username = await resolveTokenUsername(request, reply, giteaService);
    if (!username) return;

    const valid = await giteaService.validateUserPassword(username, oldPassword);
    if (!valid) {
      return reply.status(401).send({ error: 'Unauthorized: current password is incorrect' });
    }

    await giteaService.changeUserPassword(username, newPassword);
    return { passwordChanged: true };
  });
}

async function deriveOrganizations(
  giteaService: GiteaService,
  username: string
): Promise<OrganizationMembership[]> {
  let orgs: GiteaOrg[];
  try {
    orgs = await giteaService.listUserOrgs(username);
  } catch {
    return [];
  }
  const memberships: OrganizationMembership[] = [];
  for (const org of orgs) {
    let owners: GiteaUser[] = [];
    try {
      owners = await giteaService.listOrgOwners(org.name);
    } catch {
      owners = [];
    }
    memberships.push({
      org: org.name,
      role: owners.some((owner) => owner.username === username) ? 'org-admin' : 'member'
    });
  }
  return memberships;
}

async function resolveTokenUsername(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return null;
  }

  const token = authorization.replace('token ', '').trim();
  const user = await giteaService.validateToken(token);
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized: invalid token' });
    return null;
  }
  return user.username;
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: 'Unauthorized: invalid credentials' });
}
