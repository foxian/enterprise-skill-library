import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeLocalStore,
  loadToolLinkManifest,
  saveConfig
} from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeToolsList, executeToolsRemove, parseToolsOption } from '../src/commands/tools.js';
import { executeUpdate } from '../src/commands/update.js';

describe('esl tools', () => {
  let homeDir: string;
  let projectDir: string;
  let localSkillDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-tools-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-tools-proj-'));
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
      '---\nname: my-local-skill\ndescription: Local test skill.\n---\n\n# My Local Skill\n'
    );
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('normalizes claude-code to the claude tool link', () => {
    expect(parseToolsOption('claude-code')).toEqual(['claude']);
  });

  it('filters tool links by the claude-code alias', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    const entries = await executeToolsList({
      projectRoot: projectDir,
      homeDir,
      tool: 'claude-code'
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.tool).toBe('claude');
  });

  it('reports a missing manifest-owned link as broken', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.rmSync(linkPath, { recursive: true, force: true });

    const entries = await executeToolsList({ projectRoot: projectDir, homeDir });
    const claudeEntry = entries.find(
      (entry) => entry.tool === 'claude' && entry.identity === '@myorg/my-local-skill'
    );

    expect(claudeEntry).toMatchObject({
      tool: 'claude',
      identity: '@myorg/my-local-skill',
      status: 'broken',
      managed: true,
      targetDir: linkPath
    });
    expect(entries.some((entry) => entry.tool === 'source')).toBe(false);
  });

  it('keeps a shared trae project link until the last tool reference is removed', async () => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['trae-intl', 'trae-cn']
    });
    const linkPath = path.join(projectDir, '.trae', 'skills', 'myorg_my-local-skill');

    await executeToolsRemove('@myorg/my-local-skill', {
      projectRoot: projectDir,
      homeDir,
      tools: ['trae-intl']
    });

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
    const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(manifest.links.map((record) => record.tool)).toEqual(['trae-cn']);

    await executeToolsRemove('@myorg/my-local-skill', {
      projectRoot: projectDir,
      homeDir,
      tools: ['trae-cn']
    });

    expect(fs.existsSync(linkPath)).toBe(false);
    const finalManifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(finalManifest.links).toEqual([]);
  });

  it('does not overwrite an unmanaged tool target and reports the conflict', async () => {
    const targetDir = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '# Manual skill\n');

    await expect(
      executeInstall(localSkillDir, {
        projectRoot: projectDir,
        homeDir,
        tools: ['claude', 'cursor']
      })
    ).rejects.toThrow(/conflict/i);

    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# Manual skill\n');
    expect(
      fs.existsSync(path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill', 'SKILL.md'))
    ).toBe(true);
    expect(
      fs.lstatSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill')).isSymbolicLink()
    ).toBe(true);
  });

  it('reports a link creation failure without rolling back the installed source', async () => {
    fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.claude', 'skills'), 'not a directory');

    await expect(
      executeInstall(localSkillDir, {
        projectRoot: projectDir,
        homeDir,
        tools: ['claude']
      })
    ).rejects.toThrow(/tool link failed/i);

    expect(
      fs.existsSync(path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill', 'SKILL.md'))
    ).toBe(true);
  });

  it('keeps repeated installs idempotent', async () => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
    const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(manifest.links).toHaveLength(1);
    expect(manifest.links[0]).toMatchObject({
      identity: '@myorg/my-local-skill',
      tool: 'claude'
    });
  });

  it('updates the linked source without adding tools that were not already linked', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    await saveConfig({ tools: ['codex'] }, { homeDir });
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-local-skill\ndescription: Updated.\n---\n\n# Updated\n'
    );

    await executeUpdate({ projectRoot: projectDir, homeDir, skillName: '@myorg/my-local-skill' });

    const linkedSkillMd = path.join(
      projectDir,
      '.claude',
      'skills',
      'myorg_my-local-skill',
      'SKILL.md'
    );
    expect(fs.readFileSync(linkedSkillMd, 'utf8')).toContain('# Updated');
    expect(fs.existsSync(path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill'))).toBe(false);
  });

  it('ensures requested tools are linked during update', async () => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@myorg/my-local-skill',
      tools: ['codex']
    });

    const codexLink = path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill');
    expect(fs.lstatSync(codexLink).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.readlinkSync(codexLink))).toBe(sourceDir);
  });

  it('lists unmanaged content and supports tool and management filters', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const manualDir = path.join(projectDir, '.codex', 'skills', 'manual-skill');
    fs.mkdirSync(manualDir, { recursive: true });
    fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# Manual\n');

    const unmanaged = await executeToolsList({
      projectRoot: projectDir,
      homeDir,
      tool: 'codex',
      unmanaged: true
    });
    expect(unmanaged).toEqual([
      expect.objectContaining({
        tool: 'codex',
        identity: 'manual-skill',
        status: 'unmanaged',
        managed: false
      })
    ]);
  });

  it('lists source-only and conflict states', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const secondSkillDir = path.join(projectDir, 'second-skill');
    fs.mkdirSync(secondSkillDir);
    fs.writeFileSync(
      path.join(secondSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/second-skill',
        version: '0.1.0',
        description: 'Second skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(secondSkillDir, 'SKILL.md'),
      '---\nname: second-skill\ndescription: Second.\n---\n'
    );
    await executeInstall(secondSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const secondLink = path.join(projectDir, '.claude', 'skills', 'myorg_second-skill');
    fs.rmSync(secondLink, { recursive: true, force: true });
    fs.mkdirSync(secondLink, { recursive: true });

    const entries = await executeToolsList({
      projectRoot: projectDir,
      homeDir,
      status: 'source-only,conflict'
    });

    expect(
      entries
        .map((entry) => `${entry.identity}:${entry.status}`)
        .sort()
    ).toEqual([
      '@myorg/my-local-skill:source-only',
      '@myorg/second-skill:conflict'
    ]);
    expect(entries.some((entry) => entry.status === 'linked')).toBe(false);
  });

  it('removes missing link records and preserves conflicting records', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const missingLink = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.rmSync(missingLink, { recursive: true, force: true });

    const secondSkillDir = path.join(projectDir, 'second-skill');
    fs.mkdirSync(secondSkillDir);
    fs.writeFileSync(
      path.join(secondSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/second-skill',
        version: '0.1.0',
        description: 'Second skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(secondSkillDir, 'SKILL.md'),
      '---\nname: second-skill\ndescription: Second.\n---\n'
    );
    await executeInstall(secondSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['cursor']
    });
    const conflictingLink = path.join(projectDir, '.cursor', 'skills', 'myorg_second-skill');
    fs.rmSync(conflictingLink, { recursive: true, force: true });
    fs.mkdirSync(conflictingLink, { recursive: true });
    fs.writeFileSync(path.join(conflictingLink, 'SKILL.md'), '# Manual\n');

    await executeToolsRemove('@myorg/my-local-skill', {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const missingResults = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(missingResults.links.map((record) => record.identity)).toEqual([
      '@myorg/second-skill'
    ]);

    const conflictResults = await executeToolsRemove('@myorg/second-skill', {
      projectRoot: projectDir,
      homeDir,
      tools: ['cursor']
    });
    expect(conflictResults).toEqual([
      expect.objectContaining({ tool: 'cursor', status: 'conflict' })
    ]);
    expect(fs.readFileSync(path.join(conflictingLink, 'SKILL.md'), 'utf8')).toBe('# Manual\n');
    const finalManifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(finalManifest.links.map((record) => record.identity)).toEqual([
      '@myorg/second-skill'
    ]);
  });

  it('replaces ESL-owned stale links with force', async () => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    const wrongSource = path.join(projectDir, 'wrong-source');
    fs.mkdirSync(wrongSource);
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.symlinkSync(
      wrongSource,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@myorg/my-local-skill',
      tools: ['claude'],
      force: true
    });

    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
  });

  it('does not let force overwrite an unmanaged directory', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });
    const manualDir = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.mkdirSync(manualDir, { recursive: true });
    fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# Manual\n');

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        skillName: '@myorg/my-local-skill',
        tools: ['claude'],
        force: true
      })
    ).rejects.toThrow(/tool link failed/i);
    expect(fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')).toBe('# Manual\n');
  });

  it('reports broken links on default update without repairing them', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-local-skill\ndescription: Updated.\n---\n\n# Updated\n'
    );

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        skillName: '@myorg/my-local-skill'
      })
    ).rejects.toThrow(/tool link issue/i);

    expect(fs.existsSync(linkPath)).toBe(false);
    expect(
      fs.readFileSync(path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill', 'SKILL.md'), 'utf8')
    ).toContain('# Updated');
  });

  it('updates only the requested skill when ensuring tool links', async () => {
    const conflictingSkillDir = path.join(projectDir, 'conflicting-skill');
    fs.mkdirSync(conflictingSkillDir);
    fs.writeFileSync(
      path.join(conflictingSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/conflicting-skill',
        version: '0.1.0',
        description: 'Conflicting skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(conflictingSkillDir, 'SKILL.md'),
      '---\nname: conflicting-skill\ndescription: Conflict.\n---\n'
    );
    await executeInstall(conflictingSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const conflictingTarget = path.join(
      projectDir,
      '.claude',
      'skills',
      'myorg_conflicting-skill'
    );
    fs.rmSync(conflictingTarget, { recursive: true, force: true });
    fs.mkdirSync(conflictingTarget, { recursive: true });

    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['cursor']
    });

    await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@myorg/my-local-skill',
      tools: ['codex']
    });

    expect(
      fs.lstatSync(path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill')).isSymbolicLink()
    ).toBe(true);
    expect(fs.existsSync(conflictingTarget)).toBe(true);
  });

  it('does not adopt an unmanaged but correct symlink', async () => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });
    const linkPath = path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill');
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(
      sourceDir,
      linkPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(
      executeInstall(localSkillDir, {
        projectRoot: projectDir,
        homeDir,
        tools: ['claude']
      })
    ).rejects.toThrow(/unmanaged/i);

    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
    const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(manifest.links).toEqual([]);
  });

  it('adds .eslib to .gitignore during project install', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    const gitignore = fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.eslib/');
    expect(gitignore).not.toContain('.skills/');
  });

  it('uses project .skills.json tools before global config defaults', async () => {
    fs.writeFileSync(
      path.join(projectDir, '.skills.json'),
      JSON.stringify({ skills: {}, tools: ['cursor'] })
    );

    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir
    });

    expect(
      fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill'))
    ).toBe(false);
  });

  it('links only the skill being installed', async () => {
    const firstSkillDir = path.join(projectDir, 'first-skill');
    fs.mkdirSync(firstSkillDir);
    fs.writeFileSync(
      path.join(firstSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/first-skill',
        version: '0.1.0',
        description: 'First skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(firstSkillDir, 'SKILL.md'),
      '---\nname: first-skill\ndescription: First.\n---\n'
    );
    await executeInstall(firstSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });
    const conflictingFirstTarget = path.join(
      projectDir,
      '.claude',
      'skills',
      'myorg_first-skill'
    );
    fs.mkdirSync(conflictingFirstTarget, { recursive: true });

    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    expect(
      fs.existsSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill'))
    ).toBe(true);
    expect(fs.existsSync(conflictingFirstTarget)).toBe(true);
  });

  it.each([
    ['claude', ['.claude', 'skills']],
    ['codex', ['.codex', 'skills']],
    ['cursor', ['.cursor', 'skills']],
    ['trae-intl', ['.trae', 'skills']],
    ['trae-cn', ['.trae', 'skills']],
    ['workbuddy', ['.workbuddy', 'skills']],
    ['opencode', ['.opencode', 'skills']],
    ['openclaw', ['skills']],
    ['hermes', ['.hermes', 'skills']]
  ] as const)('links %s to the expected project directory', async (tool, segments) => {
    const sourceDir = path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: [tool]
    });

    const linkPath = path.join(projectDir, ...segments, 'myorg_my-local-skill');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
  });

  it.each([
    ['claude', ['.claude', 'skills']],
    ['codex', ['.codex', 'skills']],
    ['cursor', ['.cursor', 'skills']],
    ['trae-intl', ['.trae', 'skills']],
    ['trae-cn', ['.trae-cn', 'skills']],
    ['workbuddy', ['.workbuddy', 'skills']],
    ['opencode', ['.config', 'opencode', 'skills']],
    ['openclaw', ['.openclaw', 'skills']],
    ['hermes', ['.hermes', 'skills']]
  ] as const)('links %s to the expected global directory', async (tool, segments) => {
    const sourceDir = path.join(homeDir, '.eslib', 'skills', '@myorg', 'my-local-skill');
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      global: true,
      tools: [tool]
    });

    const linkPath = path.join(homeDir, ...segments, 'myorg_my-local-skill');
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.readlinkSync(linkPath))).toBe(sourceDir);
  });
});
