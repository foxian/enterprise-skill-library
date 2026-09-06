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
      giteaAdminUsername: 'eslroot',
      giteaAdminPassword: undefined,
      repoOwner: 'esl-skills',
      passwordMinLength: 12,
      autoSeed: false,
      deploymentMode: 'multi',
      defaultOrg: undefined,
      orgAdminPassword: undefined
    });
  });

  it('defaults autoSeed to false and enables it via ESL_AUTO_SEED', () => {
    const disabled = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token'
    } as NodeJS.ProcessEnv);
    expect(disabled.autoSeed).toBe(false);

    const enabled = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_AUTO_SEED: 'true'
    } as NodeJS.ProcessEnv);
    expect(enabled.autoSeed).toBe(true);
  });

  it('loads the shared password minimum length', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_PASSWORD_MIN_LENGTH: '16'
    } as NodeJS.ProcessEnv);

    expect(config.passwordMinLength).toBe(16);
  });

  it('loads the application encryption key', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_APPLICATION_ENCRYPTION_KEY: 'a'.repeat(64)
    } as NodeJS.ProcessEnv);

    expect(config.applicationEncryptionKey).toBe('a'.repeat(64));
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

  it('defaults to multi deployment mode without single-org bootstrap declarations', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token'
    } as NodeJS.ProcessEnv);

    expect(config.deploymentMode).toBe('multi');
    expect(config.defaultOrg).toBeUndefined();
    expect(config.orgAdminPassword).toBeUndefined();
  });

  it('loads single-organization bootstrap declarations', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_DEPLOYMENT_MODE: 'single',
      ESL_DEFAULT_ORG: 'acme',
      ESL_ORG_ADMIN_PASSWORD: 'initial-password'
    } as NodeJS.ProcessEnv);

    expect(config.deploymentMode).toBe('single');
    expect(config.defaultOrg).toBe('acme');
    expect(config.orgAdminPassword).toBe('initial-password');
  });

  it('rejects an invalid deployment mode value', () => {
    expect(() =>
      loadServerConfig({
        DATABASE_PATH: '/tmp/esl.db',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_DEPLOYMENT_MODE: 'banana'
      } as NodeJS.ProcessEnv)
    ).toThrow('Invalid ESL_DEPLOYMENT_MODE: banana');
  });

  it('requires the default org and admin password declarations in single mode', () => {
    expect(() =>
      loadServerConfig({
        DATABASE_PATH: '/tmp/esl.db',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_DEPLOYMENT_MODE: 'single'
      } as NodeJS.ProcessEnv)
    ).toThrow('Missing required environment variable: ESL_DEFAULT_ORG');
  });

  it('loads the default org declarations in multi mode when both are provided', () => {
    const config = loadServerConfig({
      DATABASE_PATH: '/tmp/esl.db',
      GITEA_URL: 'http://gitea:3000',
      GITEA_ADMIN_TOKEN: 'admin-token',
      ESL_DEPLOYMENT_MODE: 'multi',
      ESL_DEFAULT_ORG: 'acme',
      ESL_ORG_ADMIN_PASSWORD: 'initial-password'
    } as NodeJS.ProcessEnv);

    expect(config.deploymentMode).toBe('multi');
    expect(config.defaultOrg).toBe('acme');
    expect(config.orgAdminPassword).toBe('initial-password');
  });

  it('requires the default org declarations to be declared together in multi mode', () => {
    expect(() =>
      loadServerConfig({
        DATABASE_PATH: '/tmp/esl.db',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_DEFAULT_ORG: 'acme'
      } as NodeJS.ProcessEnv)
    ).toThrow('ESL_DEFAULT_ORG and ESL_ORG_ADMIN_PASSWORD must be declared together');

    expect(() =>
      loadServerConfig({
        DATABASE_PATH: '/tmp/esl.db',
        GITEA_URL: 'http://gitea:3000',
        GITEA_ADMIN_TOKEN: 'admin-token',
        ESL_ORG_ADMIN_PASSWORD: 'initial-password'
      } as NodeJS.ProcessEnv)
    ).toThrow('ESL_DEFAULT_ORG and ESL_ORG_ADMIN_PASSWORD must be declared together');
  });
});
