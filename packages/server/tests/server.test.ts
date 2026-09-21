import { describe, expect, it, vi } from 'vitest';
import { reportStartupFailure, startServer } from '../src/server.js';
import { GiteaService } from '../src/services/gitea.js';
import { createLogCapture, recordsForEvent } from './helpers/log-capture.js';

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
        ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
      } as NodeJS.ProcessEnv,
      listen,
      readFile,
      logger: false,
      giteaServiceFactory: () => ({
        validateToken: async () => ({ id: 1, username: 'admin', email: 'admin@local.esl' }),
        validateAdminToken: async () => true
      }) as any
    });

    expect(readFile).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });

  it('starts with the Gitea admin token loaded from file', async () => {
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const readFile = vi.fn().mockResolvedValue('admin-token\n');
    const customFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, username: 'admin', email: 'admin@local.esl' }) })
      .mockResolvedValueOnce({ ok: true });

    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token',
        ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
      } as NodeJS.ProcessEnv,
      listen,
      readFile,
      logger: false,
      giteaServiceFactory: (url, token) => new GiteaService(url, token, customFetch as any)
    });

    expect(readFile).toHaveBeenCalledWith('/bootstrap/gitea-admin-token', 'utf8');
    expect(customFetch).toHaveBeenCalledWith('http://gitea:3000/api/v1/user', {
      headers: { Authorization: 'token admin-token' }
    });
    expect(listen).toHaveBeenCalledWith({ port: 3999, host: '0.0.0.0' });
    await app.close();
  });

  it('validates the Gitea admin token before listening', async () => {
    const events: string[] = [];
    const listen = vi.fn().mockImplementation(async () => {
      events.push('listen');
      return 'http://127.0.0.1:3999';
    });
    const giteaService = {
      validateToken: vi.fn().mockImplementation(async () => {
        events.push('validate');
        return { id: 1, username: 'admin', email: 'admin@local.esl' };
      }),
      validateAdminToken: vi.fn().mockImplementation(async () => {
        events.push('validate');
        return true;
      })
    };

    const app = await startServer({
      env: {
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token'
      } as NodeJS.ProcessEnv,
      listen,
      logger: false,
      giteaServiceFactory: () => giteaService as any
    });

    expect(giteaService.validateToken).toHaveBeenCalledWith('admin-token');
    expect(events).toEqual(['validate', 'listen']);
    await app.close();
  });

  it('does not listen when the Gitea admin token is invalid', async () => {
    const listen = vi.fn();

    await expect(
      startServer({
        env: {
          DATABASE_PATH: ':memory:',
          GITEA_URL: 'http://gitea:3000',
          GITEA_ADMIN_TOKEN: 'invalid-token'
        } as NodeJS.ProcessEnv,
        listen,
        giteaServiceFactory: () => ({
          validateToken: async () => null,
          validateAdminToken: async () => false
        }) as any
      })
    ).rejects.toThrow('Invalid Gitea admin token');

    expect(listen).not.toHaveBeenCalled();
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

  it('records server.started with the listening port', async () => {
    const capture = createLogCapture();
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');
    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token'
      } as NodeJS.ProcessEnv,
      listen,
      logger: capture.logger,
      giteaServiceFactory: () =>
        ({ validateToken: async () => ({ id: 1, username: 'admin', email: 'admin@local.esl' }) }) as never
    });

    const started = recordsForEvent(capture, 'server.started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ outcome: 'succeeded', port: 3999, level: 30 });
    await app.close();
  });

  it('records server.start.failed and still rejects when listening fails', async () => {
    const capture = createLogCapture();
    const listen = vi.fn().mockRejectedValue(new Error('port already in use'));

    await expect(
      startServer({
        env: {
          DATABASE_PATH: ':memory:',
          GITEA_URL: 'http://gitea:3000',
          GITEA_ADMIN_TOKEN: 'admin-token'
        } as NodeJS.ProcessEnv,
        listen,
        logger: capture.logger,
        giteaServiceFactory: () =>
          ({ validateToken: async () => ({ id: 1, username: 'admin', email: 'admin@local.esl' }) }) as never
      })
    ).rejects.toThrow('port already in use');

    const failed = recordsForEvent(capture, 'server.start.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ outcome: 'failed', level: 50 });
    expect((failed[0].err as { message: string }).message).toBe('port already in use');
  });

  it('writes one stderr diagnostic when startup fails before a logger exists', () => {
    const lines: string[] = [];

    reportStartupFailure(new Error('Invalid LOG_LEVEL: verbose'), (line) => lines.push(line));

    expect(lines).toEqual(['ESL API Server failed to start: Invalid LOG_LEVEL: verbose\n']);
  });

  
  
  });
