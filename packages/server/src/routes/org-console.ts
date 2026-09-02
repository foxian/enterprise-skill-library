import crypto from 'node:crypto';
import { buildGiteaUsername, validateMemberUsername, validatePassword } from '@esl/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GiteaService } from '../services/gitea.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
  passwordMinLength?: number;
}

const DEFAULT_TEAM_NAMES = new Set(['all-readers', 'all-writers']);

export function registerOrgConsoleRoutes(app: FastifyInstance, options: OrgConsoleRouteOptions): void {
  const { giteaService } = options;

  app.get('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    return giteaService.listOrgMembers(org);
  });

  app.post('/api/orgs/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
    await giteaService.createUser(giteaUsername, initialPassword);
    for (const team of await giteaService.listTeams(org)) {
      if (DEFAULT_TEAM_NAMES.has(team.name)) {
        await giteaService.addTeamMember(team.id, giteaUsername);
      }
    }
    const result: { username: string; password?: string } = { username: giteaUsername };
    if (!password) {
      result.password = initialPassword;
    }
    return reply.status(201).send(result);
  });

  app.post('/api/orgs/members/:username/disable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    // prohibit_login also invalidates the member's existing access tokens.
    await giteaService.disableUser(giteaUsername);
    for (const team of await giteaService.listTeams(org)) {
      await giteaService.removeTeamMember(team.id, giteaUsername);
    }
    await giteaService.removeOrgMember(org, giteaUsername);
    return { username: giteaUsername, disabled: true };
  });

  app.post('/api/orgs/members/:username/enable', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const giteaUsername = buildGiteaUsername(org, username);
    if (!giteaUsername) {
      return reply.status(400).send({ error: 'Member username produces a Gitea username that is too long' });
    }
    // 对称于 disable：恢复登录能力并重新加入两个默认全员团队。
    await giteaService.enableUser(giteaUsername);
    for (const team of await giteaService.listTeams(org)) {
      if (DEFAULT_TEAM_NAMES.has(team.name)) {
        await giteaService.addTeamMember(team.id, giteaUsername);
      }
    }
    return { username: giteaUsername, enabled: true };
  });

  app.post('/api/orgs/members/:username/password', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
    await giteaService.changeUserPassword(giteaUsername, resolvedPassword);
    const result: { username: string; password?: string } = { username: giteaUsername };
    if (!password) {
      result.password = resolvedPassword;
    }
    return result;
  });

  app.get('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    return giteaService.listTeams(org);
  });

  app.post('/api/orgs/teams', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    return giteaService.listTeamMembers(teamId);
  });

  app.post('/api/orgs/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
    const org = await requireOrgAdministrator(request, reply, giteaService);
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
  giteaService: GiteaService
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
  return org;
}

function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
