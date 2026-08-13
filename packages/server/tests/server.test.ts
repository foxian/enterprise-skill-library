import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';

describe('server runtime', () => {
  it('starts Fastify with env config and injected listen behavior', async () => {
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token',
        GITEA_REPO_OWNER: 'platform-skills',
        ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
      } as NodeJS.ProcessEnv,
      listen
    });

    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });
});
