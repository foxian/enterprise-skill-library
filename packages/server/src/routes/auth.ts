import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';

export interface AuthRouteOptions {
  repository: AdminRepository;
  giteaService: GiteaService;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { repository, giteaService } = options;

  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
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

    return { token, username };
  });

  app.post('/api/auth/password', async (request, reply) => {
    const { oldPassword, newPassword } = request.body as { oldPassword?: string; newPassword?: string };
    if (!oldPassword || !newPassword) {
      return reply.status(400).send({ error: 'Current and new passwords are required' });
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
