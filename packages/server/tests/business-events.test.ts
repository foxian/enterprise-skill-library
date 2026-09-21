import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { initDatabase } from '../src/db/database.js';
import { createGlobalGitea, type GlobalGiteaFake } from './helpers/global-gitea.js';
import {
  createLogCapture,
  recordsForEvent,
  requestRecords,
  type LogCapture
} from './helpers/log-capture.js';

// 关键业务事件只在状态变化、安全事件、发布事件与系统生命周期上产生（ADR-0045）。
// 这里从 HTTP 边界驱动真实流程，断言事件名、结果、操作者、组织与资源字段。
describe('business event log', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let capture: LogCapture;
  let gitea: GlobalGiteaFake;
  let aliceToken: string;

  const releaseManifest = (name = '@alice/reviewer') =>
    JSON.stringify({
      schemaVersion: 3,
      name,
      version: '0.1.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    });

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-events-'));
    dbPath = path.join(tmpDir, 'test.db');
    capture = createLogCapture();
    gitea = createGlobalGitea({
      users: [
        { username: 'alice', password: 'alice-password' },
        { username: 'eslroot', password: 'root-password' }
      ],
      orgs: []
    });
    aliceToken = (await gitea.loginUser('alice', 'alice-password'))!;
    const db = initDatabase(dbPath);
    db.close();
    app = buildApp({
      dbPath,
      packageRoot: path.join(tmpDir, 'packages'),
      giteaService: gitea as never,
      repoOwner: 'esl-skills',
      logger: capture.logger
    });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const auth = () => ({ authorization: `token ${aliceToken}` });

  async function uploadSkill(name = 'reviewer') {
    return app.inject({
      method: 'POST',
      url: '/api/skills/upload',
      headers: auth(),
      payload: { name, description: 'Review code' }
    });
  }

  async function publishSkill(version = '1.0.0', manifestName = '@alice/reviewer') {
    return app.inject({
      method: 'POST',
      url: '/api/skills/@alice/reviewer/releases',
      headers: auth(),
      payload: {
        version,
        sourceCommit: 'abc123',
        releaseManifest: JSON.parse(releaseManifest(manifestName))
      }
    });
  }

  it('records skill.source-upload for a first upload', async () => {
    const response = await uploadSkill();

    expect(response.statusCode).toBe(201);
    const events = recordsForEvent(capture, 'skill.source-upload');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'succeeded',
      actorUsername: 'alice',
      organization: 'alice',
      resourceType: 'skill',
      resourceId: expect.stringMatching(/^sk_/)
    });
  });

  it('records skill.published with the released identity', async () => {
    const uploaded = await uploadSkill();
    const skillId = uploaded.json().skillId as string;

    const response = await publishSkill();

    expect(response.statusCode).toBe(201);
    const events = recordsForEvent(capture, 'skill.published');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'succeeded',
      actorUsername: 'alice',
      organization: 'alice',
      resourceType: 'skill',
      resourceId: skillId
    });
    expect(typeof events[0].durationMs).toBe('number');
  });

  it('records a rejected publish with the API error code', async () => {
    await uploadSkill();

    const response = await publishSkill('1.0.0', '@alice/other-skill');

    expect(response.statusCode).toBe(409);
    const events = recordsForEvent(capture, 'skill.published');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'failed',
      actorUsername: 'alice',
      errorCode: 'releaseManifestNameMismatch'
    });
  });

  it('records organization creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: auth(),
      payload: { orgName: 'acme' }
    });

    expect(response.statusCode).toBe(201);
    const events = recordsForEvent(capture, 'organization.create');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'succeeded',
      actorUsername: 'alice',
      organization: 'acme',
      resourceType: 'organization',
      resourceId: 'acme'
    });
  });

  it('records a rejected organization claim with the API error code', async () => {
    await app.inject({ method: 'POST', url: '/api/orgs', headers: auth(), payload: { orgName: 'acme' } });
    await gitea.createOrg('beta');

    const response = await app.inject({
      method: 'POST',
      url: '/api/orgs',
      headers: auth(),
      payload: { orgName: 'beta' }
    });

    expect(response.statusCode).toBe(409);
    const events = recordsForEvent(capture, 'organization.create');
    expect(events.at(-1)).toMatchObject({
      outcome: 'failed',
      errorCode: 'organizationNameIsAlreadyTaken',
      organization: 'beta'
    });
  });

  it('does not record a business event for an ordinary read', async () => {
    await app.inject({ method: 'GET', url: '/api/skills/search?q=reviewer', headers: auth() });

    expect(requestRecords(capture).filter((record) => record.event !== undefined)).toHaveLength(0);
  });
});
