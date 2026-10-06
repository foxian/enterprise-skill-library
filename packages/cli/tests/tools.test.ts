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
import { parseToolsOption } from '../src/commands/tools.js';
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

  it('rejects an empty --tools list', () => {
    expect(() => parseToolsOption('')).toThrow(/at least one tool/i);
    expect(() => parseToolsOption('   ')).toThrow(/at least one tool/i);
  });

  it('reconciles --tools as an expected set, removing links outside it', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude', 'cursor']
    });

    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    expect(
      fs.lstatSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill')).isSymbolicLink()
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill'))
    ).toBe(false);
    const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(manifest.links.map((record) => record.tool)).toEqual(['claude']);
  });

  it('keeps existing links and fails when an expected link conflicts during reconciliation', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    const blockedTarget = path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill');
    fs.mkdirSync(path.dirname(blockedTarget), { recursive: true });
    fs.mkdirSync(blockedTarget);

    await expect(
      executeInstall(localSkillDir, {
        projectRoot: projectDir,
        homeDir,
        tools: ['claude', 'codex']
      })
    ).rejects.toThrow(/tool link failed/i);

    expect(
      fs.lstatSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill')).isSymbolicLink()
    ).toBe(true);
    const manifest = await loadToolLinkManifest(path.join(projectDir, '.eslib'));
    expect(manifest.links.map((record) => record.tool)).toEqual(['claude']);
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

  it('rejects update with tools since tool selection moved to install/link', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    await expect(
      executeUpdate({
        projectRoot: projectDir,
        homeDir,
        skillName: '@myorg/my-local-skill',
        // Cast keeps the legacy call shape; the command no longer accepts it.
        tools: ['codex'] as never
      })
    ).rejects.toThrow(/--tools/);
  });

  it('repairs a broken recorded link on default update', async () => {
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

    await executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@myorg/my-local-skill'
    });

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(
      fs.readFileSync(path.join(projectDir, '.eslib', 'skills', '@myorg', 'my-local-skill', 'SKILL.md'), 'utf8')
    ).toContain('# Updated');
  });

  it('update no longer creates tool links and ignores conflicts of other skills', async () => {
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
      skillName: '@myorg/my-local-skill'
    });

    expect(fs.existsSync(path.join(projectDir, '.codex', 'skills', 'myorg_my-local-skill'))).toBe(false);
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

  it('ignores legacy tools declared in project .skills.json', async () => {
    fs.writeFileSync(
      path.join(projectDir, '.skills.json'),
      JSON.stringify({ skills: {}, tools: ['cursor'] })
    );

    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    // Only the explicitly requested tool applies; project-side tool
    // declarations are legacy state (ADR-0054).
    expect(
      fs.existsSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill'))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill'))
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
