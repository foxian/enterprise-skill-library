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
      giteaAdminToken: 'admin-token'
    });
  });

  it('throws a clear error for missing required variables', () => {
    expect(() => loadServerConfig({} as NodeJS.ProcessEnv)).toThrow(
      'Missing required environment variable: DATABASE_PATH'
    );
  });
});
