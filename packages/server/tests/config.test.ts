import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../src/config.js';

describe('server config', () => {
  it('loads required environment variables and defaults PORT to 3000', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token'
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      port: 3000,
      databasePath: '/tmp/esl.db',
      giteaUrl: 'http://gitea:3000',
      giteaAdminToken: 'admin-token',
      giteaAdminTokenFile: '/bootstrap/gitea-admin-token',
      giteaAdminUsername: 'admin',
      giteaAdminPassword: undefined,
      repoOwner: 'esl-skills',
      bootstrapAdminToken: 'bootstrap-token'
    });
  });

  it('loads the configured repository owner', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      GITEA_REPO_OWNER: 'platform-skills'
    } as NodeJS.ProcessEnv);

    expect(config.repoOwner).toBe('platform-skills');
  });

  it('loads the configured bootstrap administrator token', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_BOOTSTRAP_ADMIN_TOKEN: 'configured-bootstrap-token'
    } as NodeJS.ProcessEnv);

    expect(config.bootstrapAdminToken).toBe('configured-bootstrap-token');
  });

  it('loads the configured Gitea admin token file and preserves direct token precedence', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
    } as NodeJS.ProcessEnv);

    expect(config.giteaAdminToken).toBe('admin-token');
    expect(config.giteaAdminTokenFile).toBe('/bootstrap/gitea-admin-token');
  });

  it('loads the configured Gitea admin username and password for bootstrap', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token',
      GITEA_ADMIN_USERNAME: 'service-admin',
      GITEA_ADMIN_PASSWORD: 'initial-password'
    } as NodeJS.ProcessEnv);

    expect(config.giteaAdminUsername).toBe('service-admin');
    expect(config.giteaAdminPassword).toBe('initial-password');
  });

  it('allows a Gitea admin token file without a direct token', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN_FILE: '/bootstrap/gitea-admin-token'
    } as NodeJS.ProcessEnv);

    expect(config.giteaAdminToken).toBeUndefined();
    expect(config.giteaAdminTokenFile).toBe('/bootstrap/gitea-admin-token');
  });

  it('throws a clear error for missing required variables', () => {
    expect(() => loadServerConfig({} as NodeJS.ProcessEnv)).toThrow(
      'Missing required environment variable: DATABASE_PATH'
    );
  });
});
