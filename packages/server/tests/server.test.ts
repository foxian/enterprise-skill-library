import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';
import { GiteaService } from '../src/services/gitea.js';

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

  it('bootstraps the default organization in single mode before listening', async () => {
    const giteaService = {
      validateToken: vi.fn().mockResolvedValue({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' }),
      validateAdminToken: vi.fn().mockResolvedValue(true),
      adminUsername: 'eslroot',
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(undefined),
      listOrgMembers: vi.fn().mockResolvedValue([]),
      listTeams: vi.fn().mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'team', permission: 'read' }),
      removeTeamMember: vi.fn().mockResolvedValue(undefined)
    };
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');

    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_DEPLOYMENT_MODE: 'single',
        ESL_DEFAULT_ORG: 'acme',
        ESL_ORG_ADMIN_PASSWORD: 'initial-password'
      } as NodeJS.ProcessEnv,
      listen,
      giteaServiceFactory: () => giteaService as any
    });

    // 触发 onReady,完成 Bootstrap 声明驱动的组织开通
    await app.ready();
    expect(giteaService.createOrg).toHaveBeenCalledWith('acme');
    expect(giteaService.createUser).toHaveBeenCalledWith('acme_admin', 'initial-password');
    expect(giteaService.createTeam).toHaveBeenCalledWith('acme', 'all-readers', 'read');
    expect(giteaService.createTeam).toHaveBeenCalledWith('acme', 'all-writers', 'write');

    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'single', defaultOrg: 'acme' });
    await app.close();
  });

  it('bootstraps the declared default organization in multi mode as well', async () => {
    const giteaService = {
      validateToken: vi.fn().mockResolvedValue({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' }),
      validateAdminToken: vi.fn().mockResolvedValue(true),
      adminUsername: 'eslroot',
      organizationExists: vi.fn().mockResolvedValue(false),
      createOrg: vi.fn().mockResolvedValue(undefined),
      createUser: vi.fn().mockResolvedValue(undefined),
      listOrgMembers: vi.fn().mockResolvedValue([]),
      listTeams: vi.fn().mockResolvedValue([{ id: 1, name: 'Owners', permission: 'owner' }]),
      listTeamMembers: vi.fn().mockResolvedValue([]),
      addTeamMember: vi.fn().mockResolvedValue(undefined),
      createTeam: vi.fn().mockResolvedValue({ id: 9, name: 'team', permission: 'read' }),
      removeTeamMember: vi.fn().mockResolvedValue(undefined)
    };
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');

    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_DEPLOYMENT_MODE: 'multi',
        ESL_DEFAULT_ORG: 'acme',
        ESL_ORG_ADMIN_PASSWORD: 'initial-password'
      } as NodeJS.ProcessEnv,
      listen,
      giteaServiceFactory: () => giteaService as any
    });

    await app.ready();
    expect(giteaService.createOrg).toHaveBeenCalledWith('acme');
    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'multi', defaultOrg: 'acme' });
    await app.close();
  });

  it('does not provision any organization in multi mode without declarations', async () => {
    const giteaService = {
      validateToken: vi.fn().mockResolvedValue({ id: 1, username: 'eslroot', email: 'eslroot@local.esl' }),
      validateAdminToken: vi.fn().mockResolvedValue(true),
      adminUsername: 'eslroot',
      createOrg: vi.fn().mockResolvedValue(undefined)
    };
    const listen = vi.fn().mockResolvedValue('http://127.0.0.1:3999');

    const app = await startServer({
      env: {
        PORT: '3999',
        DATABASE_PATH: ':memory:',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token'
      } as NodeJS.ProcessEnv,
      listen,
      giteaServiceFactory: () => giteaService as any
    });

    await app.ready();
    expect(giteaService.createOrg).not.toHaveBeenCalled();
    const info = await app.inject({ method: 'GET', url: '/api/public/platform-info' });
    expect(info.json()).toEqual({ mode: 'multi', defaultOrg: null });
    await app.close();
  });
});
