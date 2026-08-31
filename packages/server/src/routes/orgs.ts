import { validateOrgName } from '@esl/core';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { OrgApplicationRepository, PlatformSettingsRepository } from '../db/database.js';
import type { GiteaService } from '../services/gitea.js';
import { initializeTenantOrganization } from '../services/org-init.js';

export interface OrgRouteOptions {
  giteaService: GiteaService;
  orgApplicationRepository: OrgApplicationRepository;
  platformSettingsRepository: PlatformSettingsRepository;
}

export function registerOrgRoutes(app: FastifyInstance, options: OrgRouteOptions): void {
  const { giteaService, orgApplicationRepository, platformSettingsRepository } = options;

  app.post('/api/orgs/apply', async (request, reply) => {
    const { orgName = '', adminDisplayName = '', password = '' } = request.body as {
      orgName?: string;
      adminDisplayName?: string;
      password?: string;
    };
    if (!orgName || !adminDisplayName || !password) {
      return reply.status(400).send({ error: 'orgName, adminDisplayName, and password are required' });
    }

    const validation = validateOrgName(orgName);
    if (!validation.success) {
      return reply.status(400).send({ error: validation.errors.join(', ') });
    }

    if (await giteaService.organizationExists(orgName)) {
      return reply.status(409).send({ error: 'Organization name is already taken' });
    }

    const mode = platformSettingsRepository.getSetting('org_registration_mode') ?? 'auto';
    if (mode === 'auto') {
      try {
        await initializeTenantOrganization(giteaService, orgName, password);
      } catch (error) {
        return reply.status(409).send({ error: `Organization initialization failed: ${(error as Error).message}` });
      }
      return reply.status(201).send({ status: 'approved' });
    }

    try {
      const application = orgApplicationRepository.createApplication({
        orgName,
        adminDisplayName,
        hashedPassword: hashPassword(password)
      });
      return reply.status(201).send({ status: 'pending', applicationId: application.id });
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) {
        return reply.status(409).send({ error: 'An application for this organization already exists' });
      }
      throw error;
    }
  });
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}
