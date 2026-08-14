import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface AdminRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
  repoOwner: string;
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions): void {
  const { repository, giteaService, repoOwner } = options;

  app.get('/api/admin/bootstrap/status', async () => {
    const status = await giteaService.getBootstrapStatus(repoOwner);
    return repository.getBootstrapStatus(status);
  });

  app.post('/api/admin/users', async (request, reply) => {
    if (!(await authorize(request, reply, repository, giteaService))) return;
    const { username } = request.body as { username: string };
    await giteaService.createUser(username);
    const user = repository.createUser(username);
    return reply.status(201).send({ username: user.username, disabled: user.disabled });
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

  app.post('/api/admin/account/password', async (request, reply) => {
    if (!(await authorizeAdministratorAccount(request, reply, giteaService))) return;
    const { password } = request.body as { password: string };
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
