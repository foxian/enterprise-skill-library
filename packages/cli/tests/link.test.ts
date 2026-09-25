import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeLocalStore,
  loadInstallManifest,
  loadSkillsJson,
  loadSkillsLock,
  saveConfig
} from '@esl/core';
import { executeInstall } from '../src/commands/install.js';
import { executeLink } from '../src/commands/link.js';
import { executeUnlink } from '../src/commands/unlink.js';
import { executeUninstall } from '../src/commands/uninstall.js';
import { executeUpdate } from '../src/commands/update.js';

function writeSkillSource(
  directory: string,
  identity: string,
  body: string,
  installedPackage = false
): void {
  const shortName = identity.startsWith('@') ? identity.split('/')[1] : identity;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${shortName}\ndescription: Test skill.\n---\n\n${body}\n`
  );
  fs.writeFileSync(
    path.join(directory, 'release.json'),
    JSON.stringify({
      schemaVersion: 3,
      name: identity,
      version: '0.2.0',
      license: 'MIT',
      keywords: [],
      compatibility: {},
      dependencies: {}
    })
  );
  if (installedPackage) {
    fs.writeFileSync(
      path.join(directory, 'skill.json'),
      JSON.stringify({
        name: identity,
        version: '0.2.0',
        description: 'Test skill.',
        author: 'ESL Test'
      })
    );
  }
}

describe('esl unlink', () => {
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-link-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-link-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('force links over an installed copy while preserving the original in staging', async () => {
    const originalDir = path.join(projectDir, 'linked-skill');
    const sourceDir = path.join(projectDir, 'linked-skill-source');
    writeSkillSource(originalDir, '@myorg/linked-skill', '# Original copy', true);
    writeSkillSource(sourceDir, '@myorg/linked-skill', '# Live source');

    await executeInstall(originalDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    const targetDir = await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude'],
      force: true
    });

    expect(fs.lstatSync(targetDir).isSymbolicLink()).toBe(true);
    expect(path.resolve(fs.readlinkSync(targetDir))).toBe(path.resolve(sourceDir));
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('# Live source');
    expect(
      fs.readFileSync(
        path.join(projectDir, '.claude', 'skills', 'myorg_linked-skill', 'SKILL.md'),
        'utf8'
      )
    ).toContain('# Live source');

    const stagedDir = path.join(projectDir, '.eslib', 'link-staging', '@myorg', 'linked-skill');
    expect(fs.readFileSync(path.join(stagedDir, 'SKILL.md'), 'utf8')).toContain('# Original copy');
    expect(fs.existsSync(path.join(sourceDir, 'skill.json'))).toBe(false);
  });

  it('restores the staged installation when unlinking a force-linked skill', async () => {
    const originalDir = path.join(projectDir, 'linked-skill');
    const sourceDir = path.join(projectDir, 'linked-skill-source');
    writeSkillSource(originalDir, '@myorg/linked-skill', '# Original copy', true);
    writeSkillSource(sourceDir, '@myorg/linked-skill', '# Live source');

    await executeInstall(originalDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });
    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude'],
      force: true
    });

    const result = await executeUnlink('@myorg/linked-skill', {
      projectRoot: projectDir,
      homeDir
    });

    expect(result.restored).toBe(true);
    expect(fs.lstatSync(result.targetDir).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(result.targetDir, 'SKILL.md'), 'utf8')).toContain('# Original copy');
    expect(fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8')).toContain('# Live source');
    expect(fs.existsSync(path.join(projectDir, '.eslib', 'link-staging'))).toBe(false);

    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@myorg/linked-skill']).toBe(`file:${originalDir}`);
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@myorg/linked-skill']).toMatchObject({
      version: '0.2.0',
      resolved: `file:${originalDir}`,
      integrity: '',
      source: 'local'
    });
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@myorg/linked-skill']).toMatchObject({
      version: '0.2.0',
      resolved: `file:${originalDir}`,
      integrity: '',
      source: 'local'
    });
  });

  it('uninstalls a linked skill without deleting its source', async () => {
    const sourceDir = path.join(projectDir, 'linked-skill-source');
    writeSkillSource(sourceDir, '@myorg/linked-skill', '# Live source');

    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    const result = await executeUninstall('@myorg/linked-skill', {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });

    expect(result.sourceRemoved).toBe(false);
    expect(result.sourcePath).toBe(path.resolve(sourceDir));
    expect(fs.existsSync(path.join(projectDir, '.eslib', 'skills', '@myorg', 'linked-skill'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, '.claude', 'skills', 'myorg_linked-skill'))).toBe(false);
    expect(fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8')).toContain('# Live source');

    const skills = await loadSkillsJson(projectDir);
    expect(skills.skills['@myorg/linked-skill']).toBeUndefined();
    const lock = await loadSkillsLock(projectDir);
    expect(lock.skills['@myorg/linked-skill']).toBeUndefined();
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@myorg/linked-skill']).toBeUndefined();
  });

  it('links a bare release name in the reserved local namespace', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');

    const targetDir = await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude']
    });

    expect(targetDir).toBe(path.join(projectDir, '.eslib', 'skills', '@local', 'draft-skill'));
    expect(path.resolve(fs.readlinkSync(targetDir))).toBe(path.resolve(sourceDir));
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@local/draft-skill']).toMatchObject({ source: 'link', resolved: path.resolve(sourceDir) });
  });

  it('completes only the namespace when --identity supplies one', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');

    const targetDir = await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      tools: ['claude'],
      identity: '@myorg'
    });

    expect(targetDir).toBe(path.join(projectDir, '.eslib', 'skills', '@myorg', 'draft-skill'));
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@myorg/draft-skill']).toMatchObject({ source: 'link' });
  });

  it('relinks only an existing source link with --force', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    const replacementDir = path.join(projectDir, 'replacement-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');
    writeSkillSource(replacementDir, 'draft-skill', '# Replacement');

    const targetDir = await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true
    });
    await expect(executeLink(replacementDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true
    })).rejects.toThrow(/already linked .*--force/i);

    await expect(executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true
    })).resolves.toBe(targetDir);

    await executeLink(replacementDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true,
      force: true
    });
    expect(path.resolve(fs.readlinkSync(targetDir))).toBe(path.resolve(replacementDir));
  });

  it('skips updates for linked skills', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Live source');

    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true
    });

    await expect(executeUpdate({
      projectRoot: projectDir,
      homeDir,
      skillName: '@local/draft-skill'
    })).resolves.toEqual([
      { name: '@local/draft-skill', from: 'link', to: 'linked (skipped)', skipped: 'link' }
    ]);
    expect(fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8')).toContain('# Live source');
  });

  it('removes a new source link without staging when unlinking', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');

    const targetDir = await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true
    });

    const result = await executeUnlink('@local/draft-skill', {
      projectRoot: projectDir,
      homeDir
    });

    expect(result.restored).toBe(false);
    expect(fs.existsSync(targetDir)).toBe(false);
    expect(fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8')).toContain('# Draft');
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@local/draft-skill']).toBeUndefined();
  });

  it('refuses to unlink a skill that is not linked by ESL', async () => {
    await expect(
      executeUnlink('@local/not-installed', {
        projectRoot: projectDir,
        homeDir
      })
    ).rejects.toThrow(/not linked by ESL/i);
  });

  it('unlinks a global link by reading release.json from cwd when the name is omitted', async () => {
    const sourceDir = path.join(projectDir, 'markdown-master');
    writeSkillSource(sourceDir, '@forg/markdown-master', '# Live');
    await executeLink(sourceDir, { homeDir, global: true, noTools: true });

    const result = await executeUnlink(undefined, {
      homeDir,
      global: true,
      cwd: sourceDir,
      projectRoot: sourceDir
    });

    expect(result.identity).toBe('@forg/markdown-master');
    expect(result.restored).toBe(false);
    const manifest = await loadInstallManifest(path.join(homeDir, '.eslib'));
    expect(manifest.skills['@forg/markdown-master']).toBeUndefined();
  });

  it('unlinks a project link from the project root via an explicit skill path', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');
    await executeLink(sourceDir, { projectRoot: projectDir, homeDir, noTools: true });

    const result = await executeUnlink('./draft-skill', {
      projectRoot: projectDir,
      homeDir,
      cwd: projectDir
    });

    expect(result.identity).toBe('@local/draft-skill');
    expect(result.restored).toBe(false);
    const manifest = await loadInstallManifest(path.join(projectDir, '.eslib'));
    expect(manifest.skills['@local/draft-skill']).toBeUndefined();
  });

  it('lists all linked identities when release.json identity mismatches the linked source path', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, 'draft-skill', '# Draft');
    await executeLink(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      noTools: true,
      identity: '@acme'
    });

    fs.writeFileSync(
      path.join(sourceDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 3,
        name: '@other/draft-skill',
        version: '0.2.0',
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );

    await expect(
      executeUnlink(undefined, {
        projectRoot: projectDir,
        homeDir,
        cwd: sourceDir
      })
    ).rejects.toThrow(/@acme\/draft-skill/i);
  });
  it('lists every linked identity when multiple manifest entries share the same source path', async () => {
    const sourceDir = path.join(projectDir, 'shared-source');
    writeSkillSource(sourceDir, '@one/shared-source', '# Shared');
    const storeRoot = path.join(projectDir, '.eslib');
    fs.mkdirSync(storeRoot, { recursive: true });
    const { saveInstallManifest } = await import('@esl/core');
    const resolvedSource = path.resolve(sourceDir);
    await saveInstallManifest(storeRoot, {
      version: 1,
      skills: {
        '@one/shared-source': {
          identity: '@one/shared-source',
          version: '0.2.0',
          resolved: resolvedSource,
          integrity: '',
          source: 'link',
          specifier: `link:${resolvedSource}`,
          sourceDir: 'skills/@one/shared-source',
          installedAt: new Date().toISOString()
        },
        '@two/shared-source': {
          identity: '@two/shared-source',
          version: '0.2.0',
          resolved: resolvedSource,
          integrity: '',
          source: 'link',
          specifier: `link:${resolvedSource}`,
          sourceDir: 'skills/@two/shared-source',
          installedAt: new Date().toISOString()
        }
      }
    });

    await expect(
      executeUnlink(undefined, {
        projectRoot: projectDir,
        homeDir,
        cwd: sourceDir
      })
    ).rejects.toThrow(/@one\/shared-source[\s\S]*@two\/shared-source|@two\/shared-source[\s\S]*@one\/shared-source/i);
  });

  it('hints project-root path or --global when bare project unlink is run inside a skill directory', async () => {
    const sourceDir = path.join(projectDir, 'draft-skill');
    writeSkillSource(sourceDir, '@local/draft-skill', '# Draft');
    await executeLink(sourceDir, { projectRoot: projectDir, homeDir, noTools: true });

    await expect(
      executeUnlink(undefined, {
        projectRoot: sourceDir,
        homeDir,
        cwd: sourceDir
      })
    ).rejects.toThrow(/project root|relative\/path|--global|@identity/i);
  });
});
