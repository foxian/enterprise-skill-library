import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildApp } from './app.js';
import { loadServerConfig, type ServerConfig } from './config.js';
import { GiteaService } from './services/gitea.js';
import { createLogger, createSilentLogger, logEvent, type DiagnosticLogger } from './logging.js';
import type { Logger } from 'pino';

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  listen?: FastifyInstance['listen'];
  readFile?: typeof readFile;
  giteaServiceFactory?: (
    baseUrl: string,
    adminToken: string,
    adminUsername?: string,
    adminPassword?: string
  ) => GiteaService;
  /**
   * 诊断日志出口。生产不传，由 LOG_LEVEL 创建；日志专项测试注入可捕获 logger；
   * 其余测试显式传 false 保持输出干净（US46）。
   */
  logger?: Logger | false;
}

// 配置解析、token 文件读取与 Git Backend token 校验失败发生在 logger 创建之前
// （ADR-0045）：入口进程为这些失败输出一条 stderr 诊断，调用方据此设置非零
// 退出码。这是唯一一个不走结构化日志的启动失败通道。
export function reportStartupFailure(
  error: unknown,
  write: (line: string) => void = (line) => process.stderr.write(line)
): void {
  const message = error instanceof Error ? error.message : String(error);
  write(`ESL API Server failed to start: ${message}\n`);
}

async function resolveGiteaAdminToken(
  config: ServerConfig,
  readTokenFile: typeof readFile
): Promise<string> {
  if (config.giteaAdminToken) {
    return config.giteaAdminToken;
  }

  if (!config.giteaAdminTokenFile) {
    throw new Error('Missing required environment variable: GITEA_ADMIN_TOKEN or GITEA_ADMIN_TOKEN_FILE');
  }

  let token: string;
  try {
    token = (await readTokenFile(config.giteaAdminTokenFile, 'utf8')).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Gitea admin token file: ${config.giteaAdminTokenFile}: ${message}`);
  }

  if (!token) {
    throw new Error(`Gitea admin token file is empty: ${config.giteaAdminTokenFile}`);
  }

  return token;
}

export async function startServer(options: StartServerOptions = {}): Promise<FastifyInstance> {
  // logger 在配置解析之后创建，使 LOG_LEVEL 已经过校验（非法级别在 loadServerConfig
  // 阶段就抛出，走 stderr 通道而不是结构化日志）。
  const config = loadServerConfig(options.env);
  const logger =
    options.logger === false
      ? createSilentLogger()
      : options.logger ?? createLogger({ level: config.logLevel });
  const adminToken = await resolveGiteaAdminToken(config, options.readFile ?? readFile);
  const giteaService = (options.giteaServiceFactory ??
    ((baseUrl, token, adminUsername, adminPassword) =>
      new GiteaService(baseUrl, token, fetch, adminUsername, adminPassword, logger)))(
    config.giteaUrl,
    adminToken,
    config.giteaAdminUsername,
    config.giteaAdminPassword
  );
  const validateToken = giteaService.validateToken.bind(giteaService);
  if (!(await validateToken(adminToken))) {
    throw new Error('Invalid Gitea admin token');
  }
  const app = buildApp({
    dbPath: config.databasePath,
    giteaService,
    repoOwner: config.repoOwner,
    passwordMinLength: config.passwordMinLength,

    autoSeed: config.autoSeed,
    logger
  });
  registerLifecycleLogging(app, logger, config.port);

  const listen = options.listen?.bind(app) ?? app.listen.bind(app);
  try {
    await listen({ port: config.port, host: '0.0.0.0' });
  } catch (error) {
    logEvent(
      logger,
      'error',
      { event: 'server.start.failed', outcome: 'failed', port: config.port, err: error },
      'Server failed to start'
    );
    // 启动失败必须继续向上抛：入口据此设置非零退出码，进程管理不会把半启动的
    // 服务当作就绪。
    await app.close().catch(() => {});
    throw error;
  }
  logEvent(
    logger,
    'info',
    { event: 'server.started', outcome: 'succeeded', port: config.port },
    'Server started'
  );
  return app;
}

// 关闭路径只观察 Fastify 自身的 close 生命周期。本期不新增 SIGTERM/SIGINT
// 优雅退出流程（ADR-0045），server.stop.failed 保留给未来的关闭失败通道。
function registerLifecycleLogging(app: FastifyInstance, logger: DiagnosticLogger, port: number): void {
  app.addHook('onClose', async () => {
    logEvent(logger, 'info', { event: 'server.stopped', outcome: 'succeeded', port }, 'Server stopped');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error: unknown) => {
    reportStartupFailure(error);
    process.exitCode = 1;
  });
}
