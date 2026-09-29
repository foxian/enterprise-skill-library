import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, loadToolLinkManifest, saveConfig } from '@esl/core';
import { executeToolsSync, formatToolSyncResults } from '../src/commands/tools.js';
import { executeInstall } from '../src/commands/install.js';

describe('esl tools sync', () => {
  it('formats repair outcomes with display names', () => {
    expect(
      formatToolSyncResults([
        {
          identity: '@cnfox/code-review',
          tool: 'codex',
          targetDir: '/proj/.codex/skills/cnfox_code-review',
          status: 'created'
        },
        {
          identity: '@cnfox/broken-skill',
          tool: 'claude',
          targetDir: '/proj/.claude/skills/cnfox_broken-skill',
          status: 'conflict',
          error: 'target link is unmanaged; ESL did not create it'
        }
      ])
    ).toEqual([
      'Codex (@cnfox/code-review): created /proj/.codex/skills/cnfox_code-review',
      'Claude Code (@cnfox/broken-skill): conflict /proj/.claude/skills/cnfox_broken-skill: target link is unmanaged; ESL did not create it'
    ]);
  });

  describe('repairs recorded links only', () => {
    let homeDir: string;
    let projectDir: string;
    let localSkillDir: string;

    beforeEach(async () => {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-sync-home-'));
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-sync-project-'));
      await initializeLocalStore({ homeDir });
      await saveConfig({ tools: ['claude'] }, { homeDir });

      localSkillDir = path.join(projectDir, 'my-local-skill');
      fs.mkdirSync(localSkillDir);
      fs.writeFileSync(
        path.join(localSkillDir, 'skill.json'),
        JSON.stringify({
          name: '@myorg/my-local-skill',
          version: '0.2.0',
          description: 'A local test skill',
          author: 'tester'
        })
      );
      fs.writeFileSync(
        path.join(localSkillDir, 'SKILL.md'),
        '---\nname: my-local-skill\ndescription: Local test skill.\n---\n'
      );
    });

    afterEach(() => {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    function linkPath(): string {
      return path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    }

    it('repairs a missing recorded link', async () => {
      await executeInstall(localSkillDir, { projectRoot: projectDir, homeDir, tools: ['claude'] });
      fs.rmSync(linkPath(), { recursive: true, force: true });

      const results = await executeToolsSync({ directory: projectDir, homeDir });

      expect(results.map((result) => result.status)).toEqual(['created']);
      expect(fs.lstatSync(linkPath()).isSymbolicLink()).toBe(true);
    });

    it('does not create links for skills that have no recorded links', async () => {
      await executeInstall(localSkillDir, { projectRoot: projectDir, homeDir, noAdapt: true });

      const results = await executeToolsSync({ directory: projectDir, homeDir });

      expect(results).toEqual([]);
      expect(fs.existsSync(linkPath())).toBe(false);
    });

    it('does not spread configured tools to other tools', async () => {
      await executeInstall(localSkillDir, { projectRoot: projectDir, homeDir, tools: ['claude'] });
      await saveConfig({ tools: ['codex', 'cursor'] }, { homeDir });

      await executeToolsSync({ directory: projectDir, homeDir });

      expect(fs.existsSync(path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill'))).toBe(false);
      expect(fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill'))).toBe(false);
      const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
      expect(manifest.links.map((record) => record.tool)).toEqual(['claude']);
    });

    it('repairs a stale ESL-owned link pointing elsewhere', async () => {
      const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
      await executeInstall(localSkillDir, { projectRoot: projectDir, homeDir, tools: ['claude'] });
      const wrongSource = path.join(projectDir, 'wrong-source');
      fs.mkdirSync(wrongSource);
      fs.rmSync(linkPath(), { recursive: true, force: true });
      fs.symlinkSync(wrongSource, linkPath(), process.platform === 'win32' ? 'junction' : 'dir');

      const results = await executeToolsSync({ directory: projectDir, homeDir });

      expect(results.map((result) => result.status)).toEqual(['created']);
      expect(path.resolve(fs.readlinkSync(linkPath()))).toBe(sourceDir);
    });

    it('reports a conflict when a recorded target is occupied by unmanaged content', async () => {
      await executeInstall(localSkillDir, { projectRoot: projectDir, homeDir, tools: ['claude'] });
      fs.rmSync(linkPath(), { recursive: true, force: true });
      fs.mkdirSync(linkPath(), { recursive: true });
      fs.writeFileSync(path.join(linkPath(), 'SKILL.md'), '# Manual\n');

      const results = await executeToolsSync({ directory: projectDir, homeDir });

      expect(results.map((result) => result.status)).toEqual(['conflict']);
      expect(fs.readFileSync(path.join(linkPath(), 'SKILL.md'), 'utf8')).toBe('# Manual\n');
    });

    it('repairs global recorded links with --global', async () => {
      await executeInstall(localSkillDir, {
        projectRoot: projectDir,
        homeDir,
        global: true,
        tools: ['claude']
      });
      const globalLink = path.join(homeDir, '.claude', 'skills', 'myorg_my-local-skill');
      fs.rmSync(globalLink, { recursive: true, force: true });

      const results = await executeToolsSync({ global: true, homeDir });

      expect(results.map((result) => result.status)).toEqual(['created']);
      expect(fs.lstatSync(globalLink).isSymbolicLink()).toBe(true);
    });
  });
});
