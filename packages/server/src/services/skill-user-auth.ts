import type { FastifyRequest } from 'fastify';
import type { AdminRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';

/** 可选登录的技能消费主体；`id` 只在 Git Backend 提供稳定数值 id 时存在。 */
export interface AuthenticatedSkillUser {
  username: string;
  id?: string;
}

/**
 * 技能消费端点的可选登录鉴权（ADR-0032）：无 `token` 头返回 null（匿名），
 * ESL 原生 token 与 Git Backend token 都接受；已签发但无效的 ESL token 不再
 * 回退到 Git Backend，避免把已吊销的凭据当成别人的身份。
 *
 * 发现面（公开目录、技能目录）与下载日志共用这一份解析，不各写一套。
 */
export async function authenticateSkillUser(
  request: FastifyRequest,
  adminRepository: AdminRepository | undefined,
  giteaService: GiteaService
): Promise<AuthenticatedSkillUser | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) return null;
  const token = authorization.replace('token ', '').trim();
  const eslUser = adminRepository?.validateUserToken(token);
  if (eslUser) return eslUser;
  if (adminRepository?.hasIssuedToken(token) || token.startsWith('esl_')) return null;
  const user = await giteaService.validateToken(token);
  // Git Backend 的数值型用户 id 稳定且不随改名变化，适合作为下载日志的
  // user_id；ESL 原生 token 没有独立数值 id，此时 user_id 留空。
  if (!user) return null;
  return typeof user.id === 'number'
    ? { username: user.username, id: String(user.id) }
    : { username: user.username };
}
