import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeLocalStore,
  loadConfig,
  loadCredentials,
  saveConfig,
  saveCredentials,
  type EslConfig,
  type ServerInstanceRecord
} from '@esl/core';
import {
  executeAddServerAddress,
  executeListServers,
  executeRemoveServer,
  executeUseServer
} from '../src/commands/server-registry.js';
import { executeLogout, formatLogout } from '../src/commands/logout.js';
import { executeWhoami, formatWhoami } from '../src/commands/whoami.js';
import {
  requireFreshToken,
  resolveNetworkConfig,
  resolveOptionalFreshToken,
  resolveServerContext
} from '../src/commands/network-options.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

function instance(instanceId: string, urls: string[], preferred = urls[0]): ServerInstanceRecord {
  return {
    instanceId,
    preferredAddress: preferred,
    addresses: urls.map((url) => ({ url, confirmedAt: '2026-01-01T00:00:00.000Z' }))
  };
}

async function seedRegistry(
  homeDir: string,
  instances: ServerInstanceRecord[],
  selectedInstanceId: string | null,
  server: string | null,
  extra: Partial<EslConfig> = {}
): Promise<void> {
  await saveConfig({ servers: instances, selectedInstanceId, server, ...extra }, { homeDir });
}

async function seedLogin(
  homeDir: string,
  instanceId: string,
  token: string,
  username: string
): Promise<void> {
  await saveCredentials(
    { token, loginAt: new Date().toISOString(), instanceId },
    { homeDir }
  );
  const config = await loadConfig({ homeDir });
  await saveConfig(
    {
      instanceAccounts: {
        ...(config.instanceAccounts ?? {}),
        [instanceId]: {
          username,
          email: `${username}@example.com`,
          organizations: [{ org: 'acme', identity: 'ordinary', isOwnerMember: false }],
          locale: null,
          legacyIdentity: false
        }
      }
    },
    { homeDir }
  );
}

describe('ESL Server instance auth isolation', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-instance-auth-'));
    await initializeLocalStore({ homeDir });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('shows B as logged out after switching away from logged-in A and keeps A credentials', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com']), instance(INSTANCE_B, ['http://b.example.com'])],
      INSTANCE_A,
      'http://a.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');

    await executeUseServer(INSTANCE_B, { homeDir });
    expect((await loadConfig({ homeDir })).server).toBe('http://b.example.com');

    const whoamiB = await executeWhoami({ homeDir });
    expect(whoamiB).toMatchObject({
      identityStatus: 'confirmed',
      instanceId: INSTANCE_B,
      loggedIn: false,
      username: null,
      server: 'http://b.example.com'
    });
    expect(formatWhoami(whoamiB)).toContain('Not logged in to the current ESL Server');
    expect(formatWhoami(whoamiB)).not.toContain('alice');

    await expect(requireFreshToken({ homeDir, server: 'http://b.example.com' })).rejects.toThrow(
      /current ESL Server .* is not logged in/i
    );

    // A 的凭据与账户快照都还在。
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');

    await executeUseServer(INSTANCE_A, { homeDir });
    const whoamiA = await executeWhoami({ homeDir });
    expect(whoamiA).toMatchObject({
      identityStatus: 'confirmed',
      instanceId: INSTANCE_A,
      loggedIn: true,
      username: 'alice',
      server: 'http://a.example.com'
    });
    expect(await requireFreshToken({ homeDir, server: 'http://a.example.com' })).toBe('token-a');
  });

  it('shares credentials between confirmed addresses of the same instance', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a1.example.com', 'http://a2.example.com'], 'http://a1.example.com')],
      INSTANCE_A,
      'http://a1.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');

    await executeUseServer('http://a2.example.com', { homeDir });
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://a2.example.com');
    expect(config.servers?.[0].preferredAddress).toBe('http://a2.example.com');

    expect(await requireFreshToken({ homeDir, server: 'http://a2.example.com' })).toBe('token-a');
    const whoami = await executeWhoami({ homeDir });
    expect(whoami.username).toBe('alice');
    expect(whoami.server).toBe('http://a2.example.com');
  });

  it('clears only the current instance on logout', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com']), instance(INSTANCE_B, ['http://b.example.com'])],
      INSTANCE_A,
      'http://a.example.com',
      {
        instanceAccounts: {
          [INSTANCE_A]: {
            username: 'alice',
            email: 'alice@example.com',
            organizations: [],
            legacyIdentity: false
          },
          [INSTANCE_B]: {
            username: 'bob',
            email: 'bob@example.com',
            organizations: [],
            legacyIdentity: false
          }
        }
      }
    );
    await saveCredentials(
      { token: 'token-a', loginAt: new Date().toISOString(), instanceId: INSTANCE_A },
      { homeDir }
    );
    await saveCredentials(
      { token: 'token-b', loginAt: new Date().toISOString(), instanceId: INSTANCE_B },
      { homeDir }
    );

    await executeUseServer(INSTANCE_B, { homeDir });
    const result = await executeLogout({ homeDir });
    expect(result).toMatchObject({ hadCredentials: true, blocked: false });

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.instances?.[INSTANCE_A]?.token).toBe('token-a');
    expect(credentials.instances?.[INSTANCE_B]).toBeUndefined();
    expect(credentials.token).toBeNull();

    const config = await loadConfig({ homeDir });
    expect(config.instanceAccounts?.[INSTANCE_A]?.username).toBe('alice');
    expect(config.instanceAccounts?.[INSTANCE_B]).toBeUndefined();

    const whoamiB = await executeWhoami({ homeDir });
    expect(whoamiB.loggedIn).toBe(false);
    expect(whoamiB.username).toBeNull();

    await executeUseServer(INSTANCE_A, { homeDir });
    expect((await executeWhoami({ homeDir })).username).toBe('alice');
  });

  it('refuses logout while the current address identity is unconfirmed', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com'])],
      INSTANCE_A,
      'http://a.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');
    await saveConfig(
      {
        server: 'http://pending.example.com',
        pendingServerAddresses: [
          { url: 'http://pending.example.com', addedAt: '2026-01-01T00:00:00.000Z' }
        ]
      },
      { homeDir }
    );

    const result = await executeLogout({ homeDir });
    expect(result).toMatchObject({ blocked: true, hadCredentials: false });
    expect(formatLogout(result)).toContain('not confirmed');
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');
  });

  it('saves an address whose identity cannot be discovered and never reuses old credentials for it', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com'])],
      INSTANCE_A,
      'http://a.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');

    const result = await executeAddServerAddress('http://pending.example.com', {
      homeDir,
      customFetch: vi.fn().mockRejectedValue(new Error('offline')) as any
    });
    expect(result).toMatchObject({ instanceId: null, pending: true });

    const listed = await executeListServers({ homeDir });
    expect(listed.pendingAddresses.map((address) => address.url)).toContain('http://pending.example.com');

    await executeUseServer('http://pending.example.com', { homeDir });
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://pending.example.com');
    expect(config.selectedInstanceId).toBeNull();

    const whoami = await executeWhoami({ homeDir });
    expect(whoami.identityStatus).toBe('unconfirmed');
    expect(whoami.loggedIn).toBe(false);
    expect(whoami.username).toBeNull();
    expect(formatWhoami(whoami)).toContain('Status: identity unconfirmed');

    await expect(
      requireFreshToken({ homeDir, server: 'http://pending.example.com' })
    ).rejects.toThrow(/identity .* is not confirmed/i);
    expect(await resolveOptionalFreshToken({ homeDir, server: 'http://pending.example.com' })).toBeNull();
    expect((await resolveNetworkConfig({ homeDir, server: 'http://pending.example.com' })).token).toBeNull();

    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const context = await resolveServerContext(
      { homeDir, server: 'http://pending.example.com', customFetch: fetchImpl as any },
      { requireIdentity: false }
    );
    expect(context.token).toBeNull();
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('falls back within the same instance when the current address is removed', async () => {
    await seedRegistry(
      homeDir,
      [
        instance(INSTANCE_A, ['http://a1.example.com', 'http://a2.example.com'], 'http://a1.example.com'),
        instance(INSTANCE_B, ['http://b.example.com'])
      ],
      INSTANCE_A,
      'http://a1.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');
    await seedLogin(homeDir, INSTANCE_B, 'token-b', 'bob');

    const result = await executeRemoveServer('http://a1.example.com', { homeDir });
    expect(result).toMatchObject({ removedInstance: false, fallbackAddress: 'http://a2.example.com' });

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://a2.example.com');
    expect(config.selectedInstanceId).toBe(INSTANCE_A);
    expect(config.servers?.find((entry) => entry.instanceId === INSTANCE_A)?.addresses.map((address) => address.url)).toEqual([
      'http://a2.example.com'
    ]);
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_B]?.token).toBe('token-b');
  });

  it('removes the instance registration and credentials when the last address is removed', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com']), instance(INSTANCE_B, ['http://b.example.com'])],
      INSTANCE_A,
      'http://a.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');
    await seedLogin(homeDir, INSTANCE_B, 'token-b', 'bob');

    const result = await executeRemoveServer('http://a.example.com', { homeDir });
    expect(result).toMatchObject({ removedInstance: true, clearedInstanceIds: [INSTANCE_A] });

    const config = await loadConfig({ homeDir });
    expect(config.server).toBeNull();
    expect(config.servers?.map((entry) => entry.instanceId)).toEqual([INSTANCE_B]);
    expect(config.instanceAccounts?.[INSTANCE_A]).toBeUndefined();

    const credentials = await loadCredentials({ homeDir });
    expect(credentials.instances?.[INSTANCE_A]).toBeUndefined();
    expect(credentials.instances?.[INSTANCE_B]?.token).toBe('token-b');

    await expect(requireFreshToken({ homeDir })).rejects.toThrow(/not confirmed|not logged in/i);
    expect((await executeWhoami({ homeDir })).identityStatus).toBe('unconfirmed');
  });

  it('removes a whole instance by ID while keeping other registrations and credentials', async () => {
    await seedRegistry(
      homeDir,
      [instance(INSTANCE_A, ['http://a.example.com']), instance(INSTANCE_B, ['http://b.example.com'])],
      INSTANCE_B,
      'http://b.example.com'
    );
    await seedLogin(homeDir, INSTANCE_A, 'token-a', 'alice');
    await seedLogin(homeDir, INSTANCE_B, 'token-b', 'bob');

    const result = await executeRemoveServer(INSTANCE_A, { homeDir });
    expect(result.clearedInstanceIds).toEqual([INSTANCE_A]);

    const config = await loadConfig({ homeDir });
    expect(config.servers?.map((entry) => entry.instanceId)).toEqual([INSTANCE_B]);
    expect(config.server).toBe('http://b.example.com');
    expect(config.selectedInstanceId).toBe(INSTANCE_B);
    expect(config.instanceAccounts?.[INSTANCE_B]?.username).toBe('bob');
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]).toBeUndefined();
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_B]?.token).toBe('token-b');
  });

  it('keeps the list read-only even when the store does not exist', async () => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-empty-'));
    try {
      const listed = await executeListServers({ homeDir: emptyHome });
      expect(listed).toEqual({ instances: [], pendingAddresses: [] });
      await expect(fs.access(path.join(emptyHome, '.eslib'))).rejects.toThrow();
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });
});
