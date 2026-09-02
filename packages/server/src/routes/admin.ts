import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatePassword } from '@esl/core';
import crypto from 'node:crypto';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface AdminRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
  passwordMinLength?: number;
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions): void {
  const { repository, giteaService, repoOwner } = options;

  app.get('/api/admin/bootstrap/status', async () => {
    const status = await giteaService.getBootstrapStatus(repoOwner);
    return repository.getBootstrapStatus(status);
  });

  app.post('/api/admin/users', async (request, reply) => {
    if (!(await authorize(request, reply, repository, giteaService))) return;
    const { username, password } = request.body as { username: string; password?: string };
    const initialPassword = password ? password : generateRandomPassword();
    const passwordValidation = validatePassword(initialPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    await giteaService.createUser(username, initialPassword);
    const user = repository.createUser(username);
    const result: { username: string; disabled: boolean; password?: string } = {
      username: user.username,
      disabled: user.disabled
    };
    if (!password) {
      result.password = initialPassword;
    }
    return reply.status(201).send(result);
  });

  app.post('/api/admin/users/:username/tokens', async (request, reply) => {
    if (!(await authorize(request, reply, repository, giteaService))) return;
    const { username } = request.params as { username: string };
    let token: string;
    try {
      token = await giteaService.issueUserToken(username);
      repository.registerIssuedToken(username, token);
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return reply.status(201).send({ token });
  });

  app.post('/api/admin/users/:username/disable', async (request, reply) => {
    if (!(await authorize(request, reply, repository, giteaService))) return;
    const { username } = request.params as { username: string };
    await giteaService.disableUser(username);
    const user = repository.disableUser(username);
    return { username: user.username, disabled: user.disabled };
  });

  app.post('/api/admin/users/:username/password', async (request, reply) => {
    if (!(await authorize(request, reply, repository, giteaService))) return;
    const { username } = request.params as { username: string };
    const { password } = request.body as { password?: string };
    const resolvedPassword = password ? password : generateRandomPassword();
    const passwordValidation = validatePassword(resolvedPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    await giteaService.changeUserPassword(username, resolvedPassword);
    const result: { username: string; password?: string } = { username };
    if (!password) {
      result.password = resolvedPassword;
    }
    return result;
  });

  app.post('/api/admin/account/password', async (request, reply) => {
    if (!(await authorizeAdministratorAccount(request, reply, giteaService))) return;
    const { password } = request.body as { password: string };
    const passwordValidation = validatePassword(password, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    await giteaService.changeAdminPassword(password);
    return { passwordChanged: true };
  });
}

async function authorizeAdministratorAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return false;
  }

  const token = authorization.replace('token ', '').trim();
  const admin = await giteaService.validateAdminUserToken(token);
  if (admin) return true;

  reply.status(403).send({ error: 'Administrator account login required to change its password' });
  return false;
}

async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AdminRepository,
  giteaService: GiteaService
): Promise<{ username: string } | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return null;
  }

  const token = authorization.replace('token ', '').trim();
  const admin = repository.getPlatformAdminForToken(token);
  if (admin) return admin;

  const giteaAdmin = await giteaService.validateAdminUserToken(token);
  if (giteaAdmin) return { username: giteaAdmin.username };

  reply.status(403).send({ error: 'Forbidden: platform administrator token required' });
  return null;
}

function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
