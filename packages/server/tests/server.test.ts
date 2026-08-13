import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';

describe('server runtime', () => {
  it('starts Fastify with env config and injected listen behavior', async () => {
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const readFile = vi.fn();
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
      listen,
      readFile
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });

  it('starts with the Gitea admin token loaded from file', async () => {
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const readFile = vi.fn().mockResolvedValue('admin-token\n');

    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token',
        GITEA_REPO_OWNER: 'platform-skills',
        ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
      } as NodeJS.ProcessEnv,
      listen,
      readFile
    });

    expect(readFile).toHaveBeenCalledWith('/bootstrap/gitea-admin-token', 'utf8');
    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });

  it('rejects an empty Gitea admin token file', async () => {
    await expect(
      startServer({
        env: {
          DATABASE_PATH: ':memory:',
          GITEA_URL: 'http://gitea:3000',
          GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
        } as NodeJS.ProcessEnv,
        readFile: vi.fn().mockResolvedValue('  \n')
      })
    ).rejects.toThrow('Gitea admin token file is empty: /bootstrap/gitea-admin-token');
  });

  it('rejects an unreadable Gitea admin token file', async () => {
    await expect(
      startServer({
        env: {
          DATABASE_PATH: ':memory:',
          GITEA_URL: 'http://gitea:3000',
          GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
        } as NodeJS.ProcessEnv,
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT'))
      })
    ).rejects.toThrow('Failed to read Gitea admin token file: /bootstrap/gitea-admin-token: ENOENT');
  });
});
