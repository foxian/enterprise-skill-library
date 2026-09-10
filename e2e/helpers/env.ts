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
  superAdmin: { username: string; password: string };
  /** 默认组织名(如 esl),成员账号为 <org>_<username> */
  org: string;
  /** 组织管理员:服务端固定创建 <org>_admin,控制台登录用户名固定为 admin */
  orgAdmin: { username: string; password: string };
}

export function resolveTestEnv(): E2ECredentials {
  loadDotEnv();
  const superPassword = process.env.GITEA_ADMIN_PASSWORD;
  const orgAdminPassword = process.env.ESL_ORG_ADMIN_PASSWORD;
  if (!superPassword || !orgAdminPassword) {
    throw new Error(
      'E2E 凭据缺失:请确认仓库根 .env 提供 GITEA_ADMIN_PASSWORD 与 ESL_ORG_ADMIN_PASSWORD(与 docker compose 共用同一份配置)。'
    );
  }
  return {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    superAdmin: { username: process.env.GITEA_ADMIN_USERNAME ?? 'eslroot', password: superPassword },
    org: process.env.ESL_DEFAULT_ORG ?? 'esl',
    orgAdmin: { username: 'admin', password: orgAdminPassword }
  };
}

/** 角色会话存储文件(storageState),由 setup 项目写入 */
export const SUPER_STATE = path.join(repoRoot, '.auth', 'super.json');
export const ORG_ADMIN_STATE = path.join(repoRoot, '.auth', 'org-admin.json');

/** E2E 成员初始密码(仅测试环境;密码策略只要求 >=12 位) */
export const MEMBER_PASSWORD = 'e2e-member-password';
