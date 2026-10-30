import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  credentialsForInstance,
  initializeLocalStore,
  loadConfig,
  loadCredentials,
  saveConfig,
  saveCredentials
} from '@esl/core';
import {
  executeAddServerAddress,
  executeListServers,
  executeRemoveServer,
  executeSetServer,
  executeUseServer,
  runStartupIdentityDiscovery
} from '../src/commands/server-registry.js';
import { resolveServerContext } from '../src/commands/network-options.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

function identityResponse(instanceId: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ instanceId, protocolVersion: 1 })
  };
}

describe('CLI Server instance registry', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-registry-'));
    await initializeLocalStore({ homeDir });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('registers and selects a newly discovered instance', async () => {
    const result = await executeSetServer('http://a.example.com/', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });

    expect(result).toMatchObject({ server: 'http://a.example.com', instanceId: INSTANCE_A });
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://a.example.com');
    expect(config.selectedInstanceId).toBe(INSTANCE_A);
    expect(config.servers?.[0].preferredAddress).toBe('http://a.example.com');
  });

  it('warns and requires acceptance before binding a new address to a known instance', async () => {
    await executeSetServer('http://a.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    const fetchImpl = vi.fn().mockResolvedValue(identityResponse(INSTANCE_A));

    await expect(
      executeAddServerAddress('http://b.example.com', {
        homeDir,
        customFetch: fetchImpl as any
      })
    ).rejects.toThrow(/could be impersonating|not cryptographic proof/);

    const warned = await executeAddServerAddress('http://b.example.com', {
      homeDir,
      customFetch: fetchImpl as any,
      acceptNewAddress: true
    });
    expect(warned).toMatchObject({ instanceId: INSTANCE_A, warned: true });

    // 已确认地址再次登记不重复提示，也不因确认状态被重置。
    const repeat = await executeAddServerAddress('http://b.example.com', {
      homeDir,
      customFetch: fetchImpl as any
    });
    expect(repeat.instanceId).toBe(INSTANCE_A);
    const config = await loadConfig({ homeDir });
    expect(config.servers?.[0].addresses.map((address) => address.url)).toEqual([
      'http://a.example.com',
      'http://b.example.com'
    ]);
  });

  it('fails closed when a registered address returns a different instance ID', async () => {
    await executeSetServer('http://a.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });

    await expect(
      executeSetServer('http://a.example.com', {
        homeDir,
        customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_B)) as any
      })
    ).rejects.toThrow(/Refusing to rebind silently/);

    const config = await loadConfig({ homeDir });
    expect(config.selectedInstanceId).toBe(INSTANCE_A);
    expect(config.servers?.[0].addresses[0].url).toBe('http://a.example.com');
  });

  it('lists, selects, and removes local registrations without touching skills', async () => {
    await executeSetServer('http://a.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    await executeAddServerAddress('http://b.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_B)) as any
    });

    const listed = await executeListServers({ homeDir });
    expect(listed.instances).toHaveLength(2);
    expect(listed.instances.find((instance) => instance.instanceId === INSTANCE_A)?.selected).toBe(true);

    await executeUseServer(INSTANCE_B, { homeDir });
    expect((await loadConfig({ homeDir })).server).toBe('http://b.example.com');

    const removed = await executeRemoveServer('http://a.example.com', { homeDir });
    expect(removed).toMatchObject({ removed: true, removedInstance: true });
    expect((await executeListServers({ homeDir })).instances).toHaveLength(1);
  });

  it('falls back to another confirmed address when the preferred address is unavailable', async () => {
    await executeSetServer('http://a.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    await executeAddServerAddress('http://b.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any,
      acceptNewAddress: true
    });
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith('http://a.example.com')) {
        throw new Error('connection refused');
      }
      return identityResponse(INSTANCE_A);
    });

    const context = await resolveServerContext({
      homeDir,
      server: 'http://a.example.com',
      customFetch: fetchImpl as any
    });
    expect(context).toMatchObject({ server: 'http://b.example.com', instanceId: INSTANCE_A });
  });

  it('does not silently bind a new startup address that claims a known instance', async () => {
    await executeSetServer('http://a.example.com', {
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    await saveConfig({ server: 'http://migrated.example.com' }, { homeDir });

    const result = await runStartupIdentityDiscovery({
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    expect(result.discovered).toBe(false);
    const config = await loadConfig({ homeDir });
    expect(config.servers?.[0].addresses.map((address) => address.url)).toEqual([
      'http://a.example.com'
    ]);
  });

  it('migrates a legacy single-server config without losing the address or credentials', async () => {
    await saveCredentials({ token: 'legacy-token', loginAt: new Date().toISOString() }, { homeDir });
    // 旧版配置只有 server 地址，没有 servers/selectedInstanceId。
    await saveConfig({ server: 'http://legacy.example.com' }, { homeDir });

    const result = await runStartupIdentityDiscovery({
      homeDir,
      customFetch: vi.fn().mockResolvedValue(identityResponse(INSTANCE_A)) as any
    });
    expect(result).toEqual({ discovered: true, instanceId: INSTANCE_A });
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://legacy.example.com');
    expect(config.selectedInstanceId).toBe(INSTANCE_A);
    expect((await loadCredentials({ homeDir })).token).toBe('legacy-token');
  });

  it('keeps local commands usable when startup identity discovery fails', async () => {
    await executeSetServer('http://offline.example.com', {
      homeDir,
      customFetch: vi.fn().mockRejectedValue(new Error('offline')) as any
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      runStartupIdentityDiscovery({ homeDir, customFetch: fetchImpl as any })
    ).resolves.toEqual({ discovered: false, instanceId: null });
    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://offline.example.com');
    expect(config.identityDiscoveryFailedAt).toBeTruthy();
    expect(await loadCredentials({ homeDir })).toMatchObject({ token: null });

    // 退避期内不重复请求。
    await runStartupIdentityDiscovery({ homeDir, customFetch: fetchImpl as any });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable error when a remote command cannot discover the instance', async () => {
    await expect(
      resolveServerContext({
        homeDir,
        server: 'http://offline.example.com',
        customFetch: vi.fn().mockRejectedValue(new Error('offline')) as any
      })
    ).rejects.toThrow(/Remote commands need the Server Instance ID/);
  });

  it('stores credentials separately per instance while keeping the legacy view', async () => {
    await saveCredentials({ token: 'token-a', loginAt: new Date().toISOString(), instanceId: INSTANCE_A }, { homeDir });
    await saveCredentials({ token: 'token-b', loginAt: new Date().toISOString(), instanceId: INSTANCE_B }, { homeDir });

    const credentials = await loadCredentials({ homeDir });
    expect(credentialsForInstance(credentials, INSTANCE_A).token).toBe('token-a');
    expect(credentialsForInstance(credentials, INSTANCE_B).token).toBe('token-b');
    // 顶层字段继续是最近一次登录的视图，兼容旧命令与旧测试。
    expect(credentials.token).toBe('token-b');
  });
});
