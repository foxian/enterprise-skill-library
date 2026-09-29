import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inspectInstallTarget,
  loadExistingManagedTools,
  PREFERRED_TOOL_THRESHOLD,
  promptExpectedTools,
  recordPreferredToolUsage
} from '../src/commands/install-interaction.js';
import { SUPPORTED_TOOLS, loadConfig } from '@esl/core';

describe('install interaction helpers', () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-interaction-store-'));
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  function writeManifests(skills: Record<string, unknown>, links: unknown[] = []): void {
    fs.writeFileSync(
      path.join(storeRoot, '.esl-install-manifest.json'),
      JSON.stringify({ version: 1, skills })
    );
    fs.writeFileSync(
      path.join(storeRoot, '.esl-tools-manifest.json'),
      JSON.stringify({ version: 1, links })
    );
  }

  describe('inspectInstallTarget', () => {
    it('reports a missing install as absent', async () => {
      await expect(inspectInstallTarget(storeRoot, '@acme/review')).resolves.toEqual({
        installed: false,
        isSourceLink: false
      });
    });

    it('reports a regular install copy', async () => {
      writeManifests({
        '@acme/review': {
          identity: '@acme/review',
          version: '1.0.0',
          source: 'registry',
          specifier: '^1.0.0',
          sourceDir: 'skills/@acme/review',
          installedAt: '2026-01-01T00:00:00.000Z'
        }
      });

      await expect(inspectInstallTarget(storeRoot, '@acme/review')).resolves.toEqual({
        installed: true,
        isSourceLink: false
      });
    });

    it('reports a Skill Source Link install', async () => {
      writeManifests({
        '@acme/review': {
          identity: '@acme/review',
          version: '1.0.0',
          source: 'link',
          specifier: 'link:/tmp/review',
          sourceDir: 'skills/@acme/review',
          installedAt: '2026-01-01T00:00:00.000Z'
        }
      });

      await expect(inspectInstallTarget(storeRoot, '@acme/review')).resolves.toEqual({
        installed: true,
        isSourceLink: true
      });
    });
  });

  describe('loadExistingManagedTools', () => {
    it('collects the ESL-managed tools of one identity at one level', async () => {
      writeManifests({}, [
        { identity: '@acme/review', tool: 'claude', level: 'project', sourceDir: 'skills/@acme/review', targetDir: '/tmp/a', createdAt: '' },
        { identity: '@acme/review', tool: 'codex', level: 'project', sourceDir: 'skills/@acme/review', targetDir: '/tmp/b', createdAt: '' },
        { identity: '@acme/review', tool: 'cursor', level: 'global', sourceDir: 'skills/@acme/review', targetDir: '/tmp/c', createdAt: '' },
        { identity: '@other/thing', tool: 'claude', level: 'project', sourceDir: 'skills/@other/thing', targetDir: '/tmp/d', createdAt: '' }
      ]);

      await expect(loadExistingManagedTools(storeRoot, '@acme/review', 'project')).resolves.toEqual([
        'claude',
        'codex'
      ]);
    });

    it('returns an empty list when nothing is linked', async () => {
      await expect(loadExistingManagedTools(storeRoot, '@acme/review', 'project')).resolves.toEqual([]);
    });
  });

  describe('recordPreferredToolUsage', () => {
    let homeDir: string;

    beforeEach(() => {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-usage-home-'));
      fs.mkdirSync(path.join(homeDir, '.eslib'), { recursive: true });
      fs.writeFileSync(
        path.join(homeDir, '.eslib', 'config.json'),
        JSON.stringify({ server: null, username: null, organizations: null, tools: [] })
      );
    });

    afterEach(() => {
      fs.rmSync(homeDir, { recursive: true, force: true });
    });

    it('is 2 selections before a tool becomes preferred', () => {
      expect(PREFERRED_TOOL_THRESHOLD).toBe(2);
    });

    it('counts selections and adds a tool to the preferred list at the threshold', async () => {
      await recordPreferredToolUsage(['claude'], { homeDir });
      let config = await loadConfig({ homeDir });
      expect(config.tools).toEqual([]);
      expect(config.toolSelectionCounts).toEqual({ claude: 1 });

      await recordPreferredToolUsage(['claude'], { homeDir });
      config = await loadConfig({ homeDir });
      expect(config.tools).toEqual(['claude']);
      expect(config.toolSelectionCounts).toEqual({ claude: 2 });

      // 已在常用列表中的工具不再重复添加，但计数继续累计。
      await recordPreferredToolUsage(['claude'], { homeDir });
      config = await loadConfig({ homeDir });
      expect(config.tools).toEqual(['claude']);
      expect(config.toolSelectionCounts).toEqual({ claude: 3 });
    });

    it('accumulates counts per tool without ever auto-removing', async () => {
      await recordPreferredToolUsage(['codex'], { homeDir });
      await recordPreferredToolUsage(['codex'], { homeDir });
      await recordPreferredToolUsage(['hermes'], { homeDir });

      const config = await loadConfig({ homeDir });
      expect(config.tools).toEqual(['codex']);
      expect(config.toolSelectionCounts).toEqual({ codex: 2, hermes: 1 });
    });

    it('tolerates a missing client config', async () => {
      const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-usage-empty-'));
      try {
        await recordPreferredToolUsage(['claude', 'claude'], { homeDir: emptyHome });
        const config = await loadConfig({ homeDir: emptyHome });
        expect(config.tools).toEqual(['claude']);
        expect(config.toolSelectionCounts).toEqual({ claude: 2 });
      } finally {
        fs.rmSync(emptyHome, { recursive: true, force: true });
      }
    });
  });

  describe('promptExpectedTools', () => {
    it('preselects the existing ESL-managed links and labels choices with display names', async () => {
      const selectTools = vi.fn().mockResolvedValue(['claude']);

      await promptExpectedTools({
        identity: '@acme/review',
        existing: ['codex'],
        preferred: ['cursor'],
        selectTools
      });

      const call = selectTools.mock.calls[0][0] as {
        message: string;
        choices: Array<{ name: string; value: string; checked: boolean }>;
      };
      expect(call.message).not.toContain('First tool mount');
      expect(call.choices).toHaveLength(SUPPORTED_TOOLS.length);
      const codex = call.choices.find((choice) => choice.value === 'codex');
      const cursor = call.choices.find((choice) => choice.value === 'cursor');
      const claude = call.choices.find((choice) => choice.value === 'claude');
      expect(codex).toMatchObject({ name: 'Codex', checked: true });
      expect(cursor).toMatchObject({ name: 'Cursor', checked: false });
      expect(claude).toMatchObject({ name: 'Claude Code', checked: false });
    });

    it('announces the first tool mount and preselects preferred tools instead', async () => {
      const selectTools = vi.fn().mockResolvedValue(['claude']);

      await promptExpectedTools({
        identity: '@acme/review',
        existing: [],
        preferred: ['hermes', 'workbuddy'],
        selectTools
      });

      const call = selectTools.mock.calls[0][0] as {
        message: string;
        choices: Array<{ value: string; checked: boolean }>;
      };
      expect(call.message).toContain('First tool mount');
      const hermes = call.choices.find((choice) => choice.value === 'hermes');
      const workbuddy = call.choices.find((choice) => choice.value === 'workbuddy');
      const codex = call.choices.find((choice) => choice.value === 'codex');
      expect(hermes).toMatchObject({ checked: true });
      expect(workbuddy).toMatchObject({ checked: true });
      expect(codex).toMatchObject({ checked: false });
    });

    it('rejects an empty selection and points at esl tools remove', async () => {
      const selectTools = vi.fn().mockResolvedValue([]);

      await expect(
        promptExpectedTools({
          identity: '@acme/review',
          existing: ['claude'],
          preferred: [],
          selectTools
        })
      ).rejects.toThrow('esl tools remove @acme/review');
    });
  });
});
