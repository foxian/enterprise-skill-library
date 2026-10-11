import { parseSkillName, isBuiltinIdentity } from '@esl/core';
import { apiUrl, fetchWithTimeout, requireFreshToken, resolveNetworkConfig, type NetworkCommandOptions } from './network-options.js';
import { requireOkResponse } from '../api-error.js';

export interface ShareOptions extends NetworkCommandOptions {
  all?: boolean;
  team?: string;
  user?: string;
  revokeTeam?: string;
  revokeUser?: string;
  visibility?: string;
  clearGrants?: boolean;
  force?: boolean;
  write?: boolean;
  manage?: boolean;
}

export type SharePermission = 'read' | 'write' | 'manage';

/**
 * 一次 share 只做一件事（ADR-0062）。返回 undefined 表示没带任何目标旗标，
 * 走只读路径：查看权限矩阵。
 *
 * action 名与服务端 `POST /permissions` 的 wire 协议一致；`reset_to_private`
 * 是既有的 wire 名（服务端语义正确：只清显式授权、不碰可见性），用户可见的
 * 名称是 `--clear-grants`。
 */
export type ShareTarget =
  | { action: 'share_all_read' | 'share_all_write' | 'share_all_manage' }
  | { action: 'set_team'; team: string; permission: SharePermission }
  | { action: 'remove_team'; team: string }
  | { action: 'add_member'; username: string; permission: SharePermission }
  | { action: 'remove_member'; username: string }
  | { action: 'reset_to_private' }
  | { action: 'set_visibility'; visibility: 'public' | 'private' };

function permissionLevel(options: ShareOptions): SharePermission {
  return options.manage ? 'manage' : options.write ? 'write' : 'read';
}

// 常设团队三档与 wire action 一一对应；read 是默认档。
const SHARE_ALL_ACTIONS = {
  read: 'share_all_read',
  write: 'share_all_write',
  manage: 'share_all_manage'
} as const;

export function resolveShareTarget(options: ShareOptions): ShareTarget | undefined {
  const targets = [
    options.all ? '--all' : undefined,
    options.team !== undefined ? '--team' : undefined,
    options.user !== undefined ? '--user' : undefined,
    options.revokeTeam !== undefined ? '--revoke-team' : undefined,
    options.revokeUser !== undefined ? '--revoke-user' : undefined,
    options.visibility !== undefined ? '--visibility' : undefined,
    options.clearGrants ? '--clear-grants' : undefined
  ].filter((entry): entry is string => entry !== undefined);

  if (targets.length > 1) {
    throw new Error(`Choose only one sharing target, got ${targets.join(' and ')}`);
  }
  if (options.write && options.manage) {
    throw new Error('Choose only one permission level: --write or --manage');
  }
  const grantsExplicitly = options.all || options.team !== undefined || options.user !== undefined;
  if ((options.write || options.manage) && !grantsExplicitly) {
    throw new Error('--write and --manage apply to --all, --team, or --user');
  }
  if (options.visibility !== undefined && options.visibility !== 'public' && options.visibility !== 'private') {
    throw new Error('--visibility must be public or private');
  }
  if (options.force && !options.clearGrants) {
    throw new Error('--force only applies to --clear-grants');
  }

  if (targets.length === 0) return undefined;
  if (options.all) {
    return { action: SHARE_ALL_ACTIONS[permissionLevel(options)] };
  }
  if (options.team !== undefined) {
    return { action: 'set_team', team: options.team, permission: permissionLevel(options) };
  }
  if (options.user !== undefined) {
    // ADR-0025 三档:manage 档授予对方协管(配权限、发布)的能力。
    return { action: 'add_member', username: options.user, permission: permissionLevel(options) };
  }
  if (options.revokeTeam !== undefined) {
    return { action: 'remove_team', team: options.revokeTeam };
  }
  if (options.revokeUser !== undefined) {
    return { action: 'remove_member', username: options.revokeUser };
  }
  if (options.clearGrants) return { action: 'reset_to_private' };
  return { action: 'set_visibility', visibility: options.visibility as 'public' | 'private' };
}

/** `GET /permissions` 的响应；只取呈现矩阵需要的字段。 */
export interface PermissionMatrixView {
  scope: string;
  skillName: string;
  sharedAllRead?: boolean;
  sharedAllWrite?: boolean;
  sharedAllManage?: boolean;
  teams?: Array<{ name: string; permission: string }>;
  members?: Array<{ username: string; permission: string }>;
  skill?: { visibility?: string };
}

/**
 * `executeShare` 的结果：把「做了什么」和「拿到的数据」一起交回调用方，
 * 免得调用方再解析一遍旗标、或对 unknown 强转。
 */
export type ShareOutcome =
  | { kind: 'matrix'; matrix: PermissionMatrixView }
  | { kind: 'visibility'; visibility: 'public' | 'private' }
  | { kind: 'updated' };

// 组织共享档位（Web 管理页称「全组织授权」）由挂了哪个常设团队推导，三档互斥。
function organizationWideAuthorization(matrix: PermissionMatrixView): SharePermission | 'none' {
  if (matrix.sharedAllManage) return 'manage';
  if (matrix.sharedAllWrite) return 'write';
  if (matrix.sharedAllRead) return 'read';
  return 'none';
}

function formatGrants(entries: Array<{ label: string; permission: string }>): string {
  if (entries.length === 0) return '(none)';
  return entries.map((entry) => `${entry.label} (${entry.permission})`).join(', ');
}

/**
 * 呈现权限矩阵（ADR-0062）。用词与 Web 管理页同一套概念（可见性、全组织授权、
 * 团队与成员授权），互不混称「共享状态」。
 */
export function formatPermissionMatrix(matrix: PermissionMatrixView): string {
  return [
    `@${matrix.scope}/${matrix.skillName}`,
    `Visibility: ${matrix.skill?.visibility ?? 'unknown'}`,
    `Organization-wide authorization: ${organizationWideAuthorization(matrix)}`,
    `Teams: ${formatGrants((matrix.teams ?? []).map((team) => ({ label: team.name, permission: team.permission })))}`,
    `Members: ${formatGrants(
      (matrix.members ?? []).map((member) => ({ label: member.username, permission: member.permission }))
    )}`
  ].join('\n');
}

export interface ClearGrantsConfirmation {
  identity: string;
  force?: boolean;
  interactive: boolean;
  confirm: (question: string) => Promise<boolean>;
}

/**
 * ADR-0062：清空全部显式授权是范围最大的一次治理操作，确认提示必须说清清的是
 * 什么、以及它不动可见性；非交互环境要求显式 `--force`（与 `source clean` 同款）。
 */
export async function confirmClearGrants(options: ClearGrantsConfirmation): Promise<void> {
  if (options.force) return;
  if (!options.interactive) {
    throw new Error(
      `Clearing every explicit team and member grant on ${options.identity} requires confirmation; ` +
        'pass --force to skip it in non-interactive runs'
    );
  }
  const confirmed = await options.confirm(
    `Clear every explicit team and member grant on ${options.identity}? ` +
      'Visibility and role-based access are not affected.'
  );
  if (!confirmed) throw new Error('Clear grants cancelled');
}

export async function executeShare(identity: string, options: ShareOptions): Promise<ShareOutcome> {
  if (isBuiltinIdentity(identity)) {
    throw new Error(`Unknown built-in skill: ${identity}; built-in skills have no permissions to share`);
  }
  const target = resolveShareTarget(options);
  const token = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const { scope, skillName } = parseSkillName(identity);
  const fetchImpl = options.customFetch ?? fetch;
  const endpoint = apiUrl(server, `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(skillName)}`);

  if (target === undefined) {
    const response = await fetchWithTimeout(fetchImpl, `${endpoint}/permissions`, {
      headers: { Authorization: `token ${token}` }
    });
    if (!response.ok) {
      await requireOkResponse(response, 'Failed to read skill permissions');
    }
    return { kind: 'matrix', matrix: (await response.json()) as PermissionMatrixView };
  }

  // 可见性走专用端点（ADR-0032/0062）：它与显式授权是两个独立状态，
  // 切换可见性不增删授权，清空授权也不改可见性。
  if (target.action === 'set_visibility') {
    const response = await fetchWithTimeout(fetchImpl, `${endpoint}/visibility`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ visibility: target.visibility })
    });
    if (!response.ok) {
      await requireOkResponse(response, 'Failed to update skill visibility');
    }
    return { kind: 'visibility', visibility: target.visibility };
  }

  const response = await fetchWithTimeout(fetchImpl, `${endpoint}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(target)
  });
  if (!response.ok) {
    await requireOkResponse(response, 'Failed to update skill permissions');
  }
  return { kind: 'updated' };
}
