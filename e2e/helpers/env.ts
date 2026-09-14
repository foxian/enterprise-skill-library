import { readFileSync } from 'node:fs';
import path from 'node:path';

// e2e/helpers -> e2e -> 仓库根
const repoRoot = path.resolve(__dirname, '..', '..');

// 读取仓库根 .env(docker compose 共用的同一份凭据),不覆盖已存在的进程变量,
// 保证 shell 显式导出的值优先。
function loadDotEnv(): void {
  let raw: string;
  try {
    raw = readFileSync(path.join(repoRoot, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export interface E2ECredentials {
  baseURL: string;
  /** 平台超级管理员（Gitea site admin，ADR-0032 结构不变） */
  superAdmin: { username: string; password: string };
  /**
   * 开发 seed 产出的全局账号密码（ESL_AUTO_SEED=true 时由
   * seedDevelopmentAccounts 创建 alice / bob）。ADR-0032：账号无组织前缀。
   */
  devPassword: string;
}

export function resolveTestEnv(): E2ECredentials {
  loadDotEnv();
  const superPassword = process.env.GITEA_ADMIN_PASSWORD;
  if (!superPassword) {
    throw new Error(
      'E2E 凭据缺失:请确认仓库根 .env 提供 GITEA_ADMIN_PASSWORD(与 docker compose 共用同一份配置)。'
    );
  }
  return {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    superAdmin: { username: process.env.GITEA_ADMIN_USERNAME ?? 'eslroot', password: superPassword },
    devPassword: process.env.ESL_DEV_PASSWORD ?? 'esl-dev-password'
  };
}

/** 超管会话存储文件(storageState),由 setup 项目写入 */
export const SUPER_STATE = path.join(repoRoot, '.auth', 'super.json');
