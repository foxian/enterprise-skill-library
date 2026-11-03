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
  type ServerInstanceRecord
} from '@esl/core';
import {
  executeListServers,
  executeRemoveServer,
  executeUseServer
} from '../src/commands/server-registry.js';
import { runServerListSession } from '../src/commands/server-list-interaction.js';

const INSTANCE_A = '11111111-1111-4111-8111-111111111111';
const INSTANCE_B = '22222222-2222-4222-8222-222222222222';

function instance(instanceId: string, urls: string[], preferred = urls[0]): ServerInstanceRecord {
  return {
    instanceId,
    preferredAddress: preferred,
    addresses: urls.map((url) => ({ url, confirmedAt: '2026-01-01T00:00:00.000Z' }))
  };
}

function promptQueue(selects: string[], confirms: boolean[] = []) {
  let selectIndex = 0;
  let confirmIndex = 0;
  return {
    selectPrompt: vi.fn(async () => selects[selectIndex++]) as any,
    confirmPrompt: vi.fn(async () => confirms[confirmIndex++]) as any
  };
}

describe('esl config server list interactive session', () => {
  let homeDir: string;
  let printed: string[];

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-server-list-tty-'));
    printed = [];
    await initializeLocalStore({ homeDir });
  });

  afterEach(async () => {
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  function depsFor(prompts: ReturnType<typeof promptQueue>) {
    return {
      ...prompts,
      list: () => executeListServers({ homeDir }),
      use: (identifier: string) => executeUseServer(identifier, { homeDir }),
      remove: (identifier: string) => executeRemoveServer(identifier, { homeDir }),
      print: (line: string) => printed.push(line)
    };
  }

  async function seedAB(): Promise<void> {
    await saveConfig(
      {
        server: 'http://a1.example.com',
        selectedInstanceId: INSTANCE_A,
        servers: [
          instance(INSTANCE_A, ['http://a1.example.com', 'http://a2.example.com'], 'http://a1.example.com'),
          instance(INSTANCE_B, ['http://b.example.com'])
        ]
      },
      { homeDir }
    );
    await saveCredentials(
      { token: 'token-a', loginAt: new Date().toISOString(), instanceId: INSTANCE_A },
      { homeDir }
    );
    await saveCredentials(
      { token: 'token-b', loginAt: new Date().toISOString(), instanceId: INSTANCE_B },
      { homeDir }
    );
  }

  it('navigates instance -> address -> use and switches only after confirmation', async () => {
    await seedAB();
    const prompts = promptQueue(
      [`instance:${INSTANCE_A}`, 'http://a2.example.com', 'use', '__exit__'],
      [true]
    );

    await runServerListSession(depsFor(prompts));

    expect(prompts.selectPrompt.mock.calls[0][0].message).toContain('Select an ESL Server instance');
    expect(prompts.selectPrompt.mock.calls[1][0].message).toContain('Select an address');
    expect(prompts.confirmPrompt.mock.calls[0][0].message).toContain(`Instance ID: ${INSTANCE_A}`);
    expect(prompts.confirmPrompt.mock.calls[0][0].message).toContain('http://a2.example.com');

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://a2.example.com');
    expect(config.servers?.[0].preferredAddress).toBe('http://a2.example.com');
    expect(printed.join('\n')).toContain(`Using ESL Server instance ${INSTANCE_A}`);
  });

  it('changes nothing when the use confirmation is rejected', async () => {
    await seedAB();
    const before = await loadConfig({ homeDir });
    const prompts = promptQueue(
      [`instance:${INSTANCE_A}`, 'http://a2.example.com', 'use', '__exit__'],
      [false]
    );

    await runServerListSession(depsFor(prompts));

    const after = await loadConfig({ homeDir });
    expect(after.server).toBe(before.server);
    expect(after.servers).toEqual(before.servers);
    expect(printed.join('\n')).toContain('Nothing changed');
  });

  it('explains fallback and keeps credentials when removing the current address', async () => {
    await seedAB();
    const prompts = promptQueue(
      [`instance:${INSTANCE_A}`, 'http://a1.example.com', 'remove', '__exit__'],
      [true]
    );

    await runServerListSession(depsFor(prompts));

    const message = prompts.confirmPrompt.mock.calls[0][0].message as string;
    expect(message).toContain('switch to http://a2.example.com');
    expect(message).toContain('credentials for this instance are kept');

    const config = await loadConfig({ homeDir });
    expect(config.server).toBe('http://a2.example.com');
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');
  });

  it('explains credential cleanup when removing the last address and then removes it', async () => {
    await seedAB();
    const prompts = promptQueue(
      [`instance:${INSTANCE_B}`, 'http://b.example.com', 'remove', '__exit__'],
      [true]
    );

    await runServerListSession(depsFor(prompts));

    const message = prompts.confirmPrompt.mock.calls[0][0].message as string;
    expect(message).toContain('last address');
    expect(message).toContain('stored credentials will be removed');
    expect(message).toContain('Server data and installed skills are not affected');

    const config = await loadConfig({ homeDir });
    expect(config.servers?.map((entry) => entry.instanceId)).toEqual([INSTANCE_A]);
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_B]).toBeUndefined();
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');
  });

  it('changes nothing when the remove confirmation is rejected', async () => {
    await seedAB();
    const before = await loadConfig({ homeDir });
    const prompts = promptQueue(
      [`instance:${INSTANCE_A}`, 'http://a1.example.com', 'remove', '__exit__'],
      [false]
    );

    await runServerListSession(depsFor(prompts));

    const after = await loadConfig({ homeDir });
    expect(after).toEqual(before);
    expect((await loadCredentials({ homeDir })).instances?.[INSTANCE_A]?.token).toBe('token-a');
    expect(printed.join('\n')).toContain('Removal cancelled');
  });

  it('manages unconfirmed pending addresses', async () => {
    await seedAB();
    await saveConfig(
      {
        pendingServerAddresses: [
          { url: 'http://pending.example.com', addedAt: '2026-01-01T00:00:00.000Z' }
        ]
      },
      { homeDir }
    );
    const prompts = promptQueue(
      ['pending:http://pending.example.com', 'remove', '__exit__'],
      [true]
    );

    await runServerListSession(depsFor(prompts));

    expect(prompts.confirmPrompt.mock.calls[0][0].message).toContain('unconfirmed address');
    const config = await loadConfig({ homeDir });
    expect(config.pendingServerAddresses).toEqual([]);
  });

  it('returns immediately with a hint when nothing is registered', async () => {
    const prompts = promptQueue([]);

    await runServerListSession(depsFor(prompts));

    expect(prompts.selectPrompt).not.toHaveBeenCalled();
    expect(printed.join('\n')).toContain('No ESL Server instances registered');
  });
});
