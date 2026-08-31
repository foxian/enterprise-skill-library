import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GiteaService } from '../services/gitea.js';

export interface OrgConsoleRouteOptions {
  giteaService: GiteaService;
}

const MEMBER_USERNAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
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
    if (!MEMBER_USERNAME_PATTERN.test(username)) {
      return reply.status(400).send({ error: 'Member username must use lowercase letters, digits, and hyphens' });
    }
    const initialPassword = password || generateRandomPassword();
    const giteaUsername = `${org}_${username}`;
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
    const giteaUsername = `${org}_${username}`;
    // prohibit_login also invalidates the member's existing access tokens.
    await giteaService.disableUser(giteaUsername);
    for (const team of await giteaService.listTeams(org)) {
      await giteaService.removeTeamMember(team.id, giteaUsername);
    }
    await giteaService.removeOrgMember(org, giteaUsername);
    return { username: giteaUsername, disabled: true };
  });

  app.post('/api/orgs/members/:username/password', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    const username = decodeURIComponent((request.params as { username: string }).username);
    const { password = '' } = request.body as { password?: string };
    const resolvedPassword = password || generateRandomPassword();
    await giteaService.changeUserPassword(`${org}_${username}`, resolvedPassword);
    const result: { username: string; password?: string } = { username: `${org}_${username}` };
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

  app.post('/api/orgs/teams/:teamId/members', async (request, reply) => {
    const org = await requireOrgAdministrator(request, reply, giteaService);
    if (!org) return;
    const teamId = Number((request.params as { teamId: string }).teamId);
    const { username = '' } = request.body as { username?: string };
    if (!MEMBER_USERNAME_PATTERN.test(username)) {
      return reply.status(400).send({ error: 'Member username must use lowercase letters, digits, and hyphens' });
    }
    if (!(await orgHasTeam(giteaService, org, teamId))) {
      return reply.status(403).send({ error: 'Team does not belong to your organization' });
    }
    const giteaUsername = `${org}_${username}`;
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
