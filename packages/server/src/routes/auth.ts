import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildGiteaUsername, deriveOrganizationRole, validatePassword } from '@esl/core';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  passwordMinLength?: number;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repository, giteaService } = options;

  // ESL CLI 专用登录:组织必填,服务端解析 <org>_<username> 并校验该账号确实
  // 属于该组织。平台管理员账号没有组织,结构性无法通过此端点登录(见 ADR-0020)。
  app.post('/api/auth/login', async (request, reply) => {
    const { org, username, password } = (request.body ?? {}) as {
      org?: string;
      username?: string;
      password?: string;
    };
    if (!org || !username || !password) {
      return reply.status(400).send({ error: 'Organization, username and password are required' });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Invalid username for the organization' });
    }
    if (giteaUsername === giteaService.adminUsername) {
      return reply.status(403).send({ error: 'Platform administrators sign in from the Admin Console' });
    }

    const token = await giteaService.loginUser(giteaUsername, password);
    if (!token) {
      return unauthorized(reply);
    }
    if (!(await isOrganizationMember(giteaService, org, giteaUsername))) {
      return reply.status(403).send({ error: `Account is not a member of organization ${org}` });
    }
    try {
      repository.registerIssuedToken(giteaUsername, token);
    } catch {
      return unauthorized(reply);
    }

    return { token, username, org, role: deriveOrganizationRole(org, username) };
  });

  // 管理后台专用登录:三类角色都收。带组织的账号按 <org>_<username> 解析并校验
  // 归属;不带组织的账号必须是平台管理员(否则一律拒绝,防止遗留的无组织普通账号
  // 被当作超级管理员)。
  app.post('/api/console/login', async (request, reply) => {
    const { org, username, password } = (request.body ?? {}) as {
      org?: string;
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }
    const giteaUsername = org ? buildGiteaUsername(org, username) : username;
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Invalid username' });
    }
    if (!org && giteaUsername !== giteaService.adminUsername) {
      return reply
        .status(403)
        .send({ error: 'Only the platform administrator account may sign in without an organization' });
    }

    const token = await giteaService.loginUser(giteaUsername, password);
    if (!token) {
      return unauthorized(reply);
    }
    if (org && !(await isOrganizationMember(giteaService, org, giteaUsername))) {
      return reply.status(403).send({ error: `Account is not a member of organization ${org}` });
    }
    try {
      repository.registerIssuedToken(giteaUsername, token);
    } catch {
      return unauthorized(reply);
    }

    return {
      token,
      username,
      org: org ?? null,
      role: org ? deriveOrganizationRole(org, username) : 'super'
    };
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

async function isOrganizationMember(
  giteaService: GiteaService,
  org: string,
  giteaUsername: string
): Promise<boolean> {
  try {
    const members = await giteaService.listOrgMembers(org);
    return members.some((member) => member.username === giteaUsername);
  } catch {
    return false;
  }
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
