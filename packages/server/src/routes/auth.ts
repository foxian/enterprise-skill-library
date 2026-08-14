import type { FastifyInstance, FastifyReply } from 'fastify';
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
}

function unauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: 'Unauthorized: invalid credentials' });
}
