import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  OrgApplicationRepository,
  PlatformSettingsRepository,
  SkillRepository
} from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { initializeTenantOrganization } from '../services/org-init.js';

export interface OrgAdminRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
  skillRepository: SkillRepository;
}

export function registerOrgAdminRoutes(app: FastifyInstance, options: OrgAdminRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository, skillRepository } = options;

  app.get('/api/admin/orgs/applications', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return orgApplicationRepository.listApplications().map(toApplicationView);
  });

  app.post('/api/admin/orgs/applications/:id/approve', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    if (application.status !== 'pending') {
      return reply.status(409).send({ error: 'Organization application has already been processed' });
    }
    if (await giteaService.organizationExists(application.orgName)) {
      return reply.status(409).send({ error: 'Organization name is already taken' });
    }

    const initialPassword = generateRandomPassword();
    try {
      await initializeTenantOrganization(giteaService, application.orgName, initialPassword);
    } catch (error) {
      return reply.status(409).send({ error: `Organization initialization failed: ${(error as Error).message}` });
    }
    orgApplicationRepository.updateApplicationStatusById(id, 'approved');
    return { status: 'approved', orgName: application.orgName, initialPassword };
  });

  app.post('/api/admin/orgs/applications/:id/reject', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const id = Number((request.params as { id: string }).id);
    const application = orgApplicationRepository.getApplicationById(id);
    if (!application) {
      return reply.status(404).send({ error: 'Organization application not found' });
    }
    if (application.status !== 'pending') {
      return reply.status(409).send({ error: 'Organization application has already been processed' });
    }
    const updated = orgApplicationRepository.updateApplicationStatusById(id, 'rejected');
    return { status: 'rejected', orgName: updated?.orgName ?? application.orgName };
  });

  app.get('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    return { orgRegistrationMode: getRegistrationMode() };
  });

  app.put('/api/admin/orgs/settings', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const { orgRegistrationMode } = (request.body ?? {}) as { orgRegistrationMode?: string };
    if (orgRegistrationMode !== 'auto' && orgRegistrationMode !== 'manual') {
      return reply.status(400).send({ error: 'orgRegistrationMode must be auto or manual' });
    }
    platformSettingsRepository.setSetting('org_registration_mode', orgRegistrationMode);
    return { orgRegistrationMode };
  });

  app.get('/api/admin/orgs', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgs = await giteaService.listOrgs();
    return Promise.all(
      orgs.map(async (org) => ({
        name: org.name,
        memberCount: (await giteaService.listOrgMembers(org.name)).length,
        skillCount: skillRepository.countSkillsByScope(org.name),
        createdAt: org.created
      }))
    );
  });

  app.delete('/api/admin/orgs/:orgName', async (request, reply) => {
    if (!(await requireSuperAdministrator(request, reply, giteaService))) return;
    const orgName = decodeURIComponent((request.params as { orgName: string }).orgName);
    const { confirm } = (request.body ?? {}) as { confirm?: string };
    if (confirm !== orgName) {
      return reply.status(400).send({ error: 'Deletion requires confirm matching the organization name' });
    }
    if (!(await giteaService.organizationExists(orgName))) {
      return reply.status(404).send({ error: 'Organization not found' });
    }
    const members = await giteaService.listOrgMembers(orgName);
    for (const member of members) {
      await giteaService.deleteUser(member.username);
    }
    await giteaService.deleteOrg(orgName);
    return { deleted: true, orgName };
  });

  function getRegistrationMode(): string {
    return platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
  }
}

function toApplicationView(application: {
  id: number;
  orgName: string;
  adminDisplayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: application.id,
    orgName: application.orgName,
    adminDisplayName: application.adminDisplayName,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

async function requireSuperAdministrator(
  request: FastifyRequest,
  reply: FastifyReply,
  giteaService: GiteaService
): Promise<boolean> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('token ')) {
    reply.status(401).send({ error: 'Unauthorized: missing token' });
    return false;
  }
  const token = authorization.replace('token ', '').trim();
  const admin = await giteaService.validateAdminUserToken(token);
  if (admin) return true;
  reply.status(403).send({ error: 'Forbidden: super administrator token required' });
  return false;
}

function generateRandomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}
