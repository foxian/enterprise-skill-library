import crypto from 'node:crypto';
import { buildGiteaUsername, validateMemberUsername, validatePassword } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OperationRepository,
  OperationSecretRepository,
  TenantOrganizationRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import type { OperationExecutor } from '../services/operation-executor.js';
import { encryptApplicationSecret } from '../services/application-secret.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
  passwordMinLength?: number;
  operationRepository: OperationRepository;
  operationSecretRepository: OperationSecretRepository;
  operationExecutor: OperationExecutor;
  tenantOrganizationRepository: TenantOrganizationRepository;
  applicationEncryptionKey?: string;
}

const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers']);

export function registerOrgConsoleRoutes(app: FastifyInstance, options: OrgConsoleRouteOptions): void {
  const { giteaService, tenantOrganizationRepository } = options;

  app.get('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    return giteaService.listOrgMembers(org);
  });

  app.post('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const { username = '', password = '' } = request.body as { username?: string; password?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    const initialPassword = password || generateRandomPassword();
    const passwordValidation = validatePassword(initialPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = createMemberOperation(options, 'create', org, giteaUsername, initialPassword);
    if (!operation) {
      return reply.status(503).send({ error: 'Member operation secret storage is unavailable' });
    }
    void options.operationExecutor.process(operation.id);
    const result: { status: string; username: string; operationId: number; password?: string } = {
      status: 'pending',
      username: giteaUsername,
      operationId: operation.id
    };
    if (!password) {
      result.password = initialPassword;
    }
    return reply.status(202).send(result);
  });

  app.post('/api/orgs/members/:username/disable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: operationIdempotencyKey(request, 'disable', org, giteaUsername),
      kind: 'member.disable',
      payload: { orgName: org, username: giteaUsername }
    });
    void options.operationExecutor.process(operation.id);
    return reply.status(202).send({ status: 'pending', username: giteaUsername, operationId: operation.id });
  });

  app.post('/api/orgs/members/:username/enable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = options.operationRepository.createOperation({
      idempotencyKey: operationIdempotencyKey(request, 'enable', org, giteaUsername),
      kind: 'member.enable',
      payload: { orgName: org, username: giteaUsername }
    });
    void options.operationExecutor.process(operation.id);
    return reply.status(202).send({ status: 'pending', username: giteaUsername, operationId: operation.id });
  });

  app.post('/api/orgs/members/:username/password', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const { password = '' } = request.body as { password?: string };
    const resolvedPassword = password || generateRandomPassword();
    const passwordValidation = validatePassword(resolvedPassword, options.passwordMinLength);
    if (!passwordValidation.success) {
      return reply.status(400).send({ error: passwordValidation.errors.join(', ') });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    const operation = createMemberOperation(options, 'password', org, giteaUsername, resolvedPassword, request);
    if (!operation) {
      return reply.status(503).send({ error: 'Member operation secret storage is unavailable' });
    }
    void options.operationExecutor.process(operation.id);
    const result: { status: string; username: string; operationId: number; password?: string } = {
      status: 'pending',
      username: giteaUsername,
      operationId: operation.id
    };
    if (!password) {
      result.password = resolvedPassword;
    }
    return reply.status(202).send(result);
  });

  app.get('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    return giteaService.listTeams(org);
  });

  app.post('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const { name = '', permission = '' } = request.body as { name?: string; permission?: string };
    if (!/^[a-z0-9-]{1,64}$/.test(name)) {
      return reply.status(400).send({ error: 'Team name must use lowercase letters, digits, and hyphens' });
    }
    if (permission !== 'read' && permission !== 'write') {
      return reply.status(400).send({ error: 'Team permission must be read or write' });
    }
    const team = await giteaService.createTeam(org, name, permission);
    return reply.status(201).send(team);
  });

  app.delete('/api/orgs/teams/:teamId', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const team = (await giteaService.listTeams(org)).find((entry) => entry.id === teamId);
    if (!team) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    if (DEFAULT_TEAM_NAMES.has(team.name)) {
      return reply.status(400).send({ error: 'Default teams cannot be deleted' });
    }
    await giteaService.deleteTeam(teamId);
    return { deleted: true };
  });

  app.get('/api/orgs/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    return giteaService.listTeamMembers(teamId);
  });

  app.post('/api/orgs/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const { username = '' } = request.body as { username?: string };
    const usernameValidation = validateMemberUsername(username);
    if (!usernameValidation.success) {
      return reply.status(400).send({ error: usernameValidation.errors.join(', ') });
    }
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    await giteaService.addTeamMember(teamId, giteaUsername);
    return reply.status(201).send({ teamId, username: giteaUsername });
  });

  app.delete('/api/orgs/teams/:teamId/members/:username', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService, tenantOrganizationRepository);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const username = decodeURIComponent((request.params as { username: string }).username);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const giteaUsername = `${org}_${username}`;
    await giteaService.removeTeamMember(teamId, giteaUsername);
    return { teamId, username: giteaUsername, removed: true };
  });
}

async function orgHasTeam(giteaService: GiteaService, org: string, teamId: number): Promise<boolean> {
  return (await giteaService.listTeams(org)).some((team) => team.id === teamId);
}

async function requireOrgAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService,
  tenantOrganizationRepository: TenantOrganizationRepository
): Promise<string | null> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return null;
  }
  const token = authorization.replace('token ', '').trim();
  const user = await giteaService.validateToken(token);
  if (!user) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  const org = user.username.replace(/_admin$/, '');
  if (org === user.username || !(await giteaService.organizationExists(org))) {
    reply.status(403).send({ error: 'Forbidden: organization administrator token required' });
    return null;
  }
  // 处理中的组织(开通、失败、删除中、删除失败)禁止一切组织管理操作。
  const tenant = tenantOrganizationRepository.get(org);
  if (tenant && tenant.status !== 'active') {
    reply.status(409).send({ error: `Organization is not active: ${org}`, status: tenant.status });
    return null;
  }
  return org;
}

function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function createMemberOperation(
  options: OrgConsoleRouteOptions,
  action: 'create' | 'password',
  org: string,
  username: string,
  password: string,
  request?: FastifyRequest
) {
  if (!options.applicationEncryptionKey) return undefined;
  const operation = options.operationRepository.createOperation({
    idempotencyKey:
      action === 'create'
        ? `member.create:${org}:${username}`
        : operationIdempotencyKey(request, 'password', org, username),
    kind: `member.${action}`,
    payload: action === 'create' ? { orgName: org, username } : { username }
  });
  options.operationSecretRepository.createIfAbsent(
    operation.id,
    encryptApplicationSecret(password, options.applicationEncryptionKey)
  );
  return operation;
}

function operationIdempotencyKey(
  request: FastifyRequest | undefined,
  action: string,
  org: string,
  username: string
): string {
  const supplied = request?.headers['idempotency-key'];
  const key = Array.isArray(supplied) ? supplied[0] : supplied;
  return key ? `member.${action}:${org}:${username}:${key}` : `member.${action}:${org}:${username}:${crypto.randomUUID()}`;
}
