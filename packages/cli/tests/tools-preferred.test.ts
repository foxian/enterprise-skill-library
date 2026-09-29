import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalStore, loadConfig, saveConfig } from '@esl/core';
import { executeToolsPreferred } from '../src/commands/tools.js';

describe('esl tools preferred', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-preferred-home-'));
    await initializeLocalStore({ homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('lists the current preferred tools by default', async () => {
    await saveConfig({ tools: ['claude', 'trae-intl'] }, { homeDir });

    const result = await executeToolsPreferred({ homeDir });

    expect(result.changed).toBe(false);
    expect(result.tools).toEqual(['claude', 'trae-intl']);
  });

  it('allows an empty preferred list', async () => {
    const result = await executeToolsPreferred({ homeDir });

    expect(result.tools).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('adds tools incrementally with --add', async () => {
    await saveConfig({ tools: ['claude'] }, { homeDir });

    const result = await executeToolsPreferred({ homeDir, add: 'codex,trae-intl' });

    expect(result.tools).toEqual(['claude', 'codex', 'trae-intl']);
    expect((await loadConfig({ homeDir })).tools).toEqual(['claude', 'codex', 'trae-intl']);
  });

  it('removes tools incrementally with --remove', async () => {
    await saveConfig({ tools: ['claude', 'cursor'] }, { homeDir });

    const result = await executeToolsPreferred({ homeDir, remove: 'cursor' });

    expect(result.tools).toEqual(['claude']);
    expect((await loadConfig({ homeDir })).tools).toEqual(['claude']);
  });

  it('rejects an unknown tool id', async () => {
    await expect(executeToolsPreferred({ homeDir, add: 'trae' })).rejects.toThrow(/Unknown tool/);
  });

  it('edits the preferred set interactively and allows clearing it', async () => {
    await saveConfig({ tools: ['claude'] }, { homeDir });
    const selectTools = vi.fn().mockResolvedValue(['codex', 'hermes']);

    const result = await executeToolsPreferred({ homeDir, interactive: true, selectTools });

    expect(result.tools).toEqual(['codex', 'hermes']);
    expect((await loadConfig({ homeDir })).tools).toEqual(['codex', 'hermes']);
    const call = selectTools.mock.calls[0][0] as {
      choices: Array<{ value: string; checked: boolean }>;
    };
    expect(call.choices.find((choice) => choice.value === 'claude')).toMatchObject({ checked: true });
    expect(call.choices.find((choice) => choice.value === 'codex')).toMatchObject({ checked: false });

    const cleared = vi.fn().mockResolvedValue([]);
    const result2 = await executeToolsPreferred({
      homeDir,
      interactive: true,
      selectTools: cleared
    });
    expect(result2.tools).toEqual([]);
    expect((await loadConfig({ homeDir })).tools).toEqual([]);
  });
});
