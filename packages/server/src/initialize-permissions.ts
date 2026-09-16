import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadServerConfig } from './config.js';
import { GiteaService } from './services/gitea.js';
import { initializePermissionData } from './services/permission-initialization.js';

async function resolveAdminToken(token: string | undefined, tokenFile: string | undefined): Promise<string> {
  if (token) return token;
  if (!tokenFile) {
    throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
  }
  const value = (await readFile(tokenFile, 'utf8')).trim();
  if (!value) throw new Error(`Gitea admin token file is empty: ${tokenFile}`);
  return value;
}

async function main(): Promise<void> {
  const config = loadServerConfig();
  const token = await resolveAdminToken(config.giteaAdminToken, config.giteaAdminTokenFile);
  const gitea = new GiteaService(
    config.giteaUrl,
    token,
    fetch,
    config.giteaAdminUsername,
    config.giteaAdminPassword
  );
  if (!(await gitea.validateToken(token))) {
    throw new Error('Invalid Gitea admin token');
  }
  await initializePermissionData(gitea, config.databasePath);
  console.log('权限数据初始化完成');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
