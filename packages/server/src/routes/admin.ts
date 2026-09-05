import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validatePassword } from '@esl/core';
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
