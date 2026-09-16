import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatePassword } from '@esl/core';
import type { AdminRepository, PlatformSettingsRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { deriveOrganizations } from '../services/organization-membership.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  platformSettingsRepository: PlatformSettingsRepository;
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

  // 管理后台专用登录：平台管理员与普通用户都收，平台角色只有这两个
  // （ADR-0033）。响应只声明两件事实——是不是平台管理员、在每个组织是什么
  // 身份（三档，ADR-0038）——由客户端据此选视角与渲染治理入口。
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

    const isPlatformAdmin = username === giteaService.adminUsername;
    return {
      token,
      username,
      isPlatformAdmin,
      // 平台管理员不属于任何组织（ADR-0033），不参与组织治理故不派生隶属关系
      organizations: isPlatformAdmin ? [] : await deriveOrganizations(giteaService, username)
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
