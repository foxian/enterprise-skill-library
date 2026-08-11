import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adaptGlobal, adaptProject } from '../src/adapt/adapt-engine.js';
import { initializeLocalStore, saveConfig } from '../src/store/local-store.js';

function writeSkill(root: string, identity: string, content = '# My Skill'): string {
  const [scope, skillName] = identity.slice(1).split('/');
  const skillDir = path.join(root, `@${scope}`, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: Test skill.\n---\n\n${content}\n`
  );
  fs.writeFileSync(
    path.join(skillDir, 'skill.json'),
    JSON.stringify({
      name: identity,
      version: '1.0.0',
      description: 'Test',
      author: 'test'
    })
  );
  return skillDir;
}

function writeAdaptedTarget(root: string, directoryName: string, identity: string, displayName: string): string {
  const targetDir = path.join(root, directoryName);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'SKILL.md'),
    `---\nname: ${displayName}\ndescription: Adapted skill.\n---\n\n# Adapted\n`
  );
  fs.writeFileSync(
    path.join(targetDir, 'skill.json'),
    JSON.stringify({
      name: identity,
      version: '1.0.0',
      description: 'Adapted',
      author: 'test'
    })
  );
  return targetDir;
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('adaptProject', () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude', 'codex'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('copies project skills to namespaced runtime snapshots for each tool directory', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');

    const result = await adaptProject(tmpDir, { homeDir });

    expect(fs.readFileSync(path.join(tmpDir, '.claude', 'skills', 'scope_my-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: scope:my-skill'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'scope_my-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: scope:my-skill'
    );
    expect(fs.lstatSync(path.join(tmpDir, '.agents', 'skills', 'scope_my-skill')).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.trae', 'skills', 'scope_my-skill'))).toBe(false);

    expect(result).toEqual([
      {
        tool: 'claude',
        skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }],
        adopted: [],
        pruned: [],
        skipped: [],
        conflicts: []
      },
      {
        tool: 'codex',
        skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }],
        adopted: [],
        pruned: [],
        skipped: [],
        conflicts: []
      }
    ]);
  });

  it('keeps same-short-name project skills in separate adapted directories', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@alice/code-review', '# Alice');
    writeSkill(path.join(tmpDir, '.skills'), '@bob/code-review', '# Bob');

    await adaptProject(tmpDir, { homeDir });

    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'alice_code-review', 'SKILL.md'), 'utf8')).toContain(
      'name: alice:code-review'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'bob_code-review', 'SKILL.md'), 'utf8')).toContain(
      'name: bob:code-review'
    );
  });

  it('preserves the local namespace in project adapted output', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@local/brainstorming');

    await adaptProject(tmpDir, { homeDir });

    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'local_brainstorming', 'SKILL.md'), 'utf8')).toContain(
      'name: local:brainstorming'
    );
  });

  it('respects project-level tools override', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');
    fs.writeFileSync(
      path.join(tmpDir, '.skills.json'),
      JSON.stringify({ skills: { '@scope/my-skill': '^1.0.0' }, tools: ['trae'] })
    );

    const result = await adaptProject(tmpDir, { homeDir });

    expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'scope_my-skill'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, '.trae', 'skills', 'scope_my-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: scope:my-skill'
    );
    expect(result).toEqual([
      {
        tool: 'trae',
        skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }],
        adopted: [],
        pruned: [],
        skipped: [],
        conflicts: []
      }
    ]);
  });

  it('does not delete unrelated project tool skill directories during normal adapt', async () => {
    const unrelatedDir = path.join(tmpDir, '.claude', 'skills', 'manual-skill');
    fs.mkdirSync(unrelatedDir, { recursive: true });
    fs.writeFileSync(path.join(unrelatedDir, 'SKILL.md'), '# Manual');
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');

    await adaptProject(tmpDir, { homeDir });

    expect(fs.readFileSync(path.join(unrelatedDir, 'SKILL.md'), 'utf8')).toBe('# Manual');
    expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'scope_my-skill', 'SKILL.md'))).toBe(true);
  });

  it('writes an Adapt Manifest for project adapted outputs', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');

    await adaptProject(tmpDir, { homeDir });

    expect(readJson(path.join(tmpDir, '.skills', '.esl-adapt-manifest.json'))).toEqual({
      version: 1,
      outputs: expect.arrayContaining([
        {
          tool: 'claude',
          identity: '@scope/my-skill',
          directoryName: 'scope_my-skill',
          displayName: 'scope:my-skill',
          targetDir: path.join(tmpDir, '.claude', 'skills', 'scope_my-skill')
        },
        {
          tool: 'codex',
          identity: '@scope/my-skill',
          directoryName: 'scope_my-skill',
          displayName: 'scope:my-skill',
          targetDir: path.join(tmpDir, '.agents', 'skills', 'scope_my-skill')
        }
      ])
    });
  });

  it('adopts an unmanifested project target when identity matches', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');
    writeAdaptedTarget(path.join(tmpDir, '.agents', 'skills'), 'scope_my-skill', '@scope/my-skill', 'scope:my-skill');

    const result = await adaptProject(tmpDir, { homeDir });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'codex',
        adopted: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }]
      })
    ]));
    expect(readJson(path.join(tmpDir, '.skills', '.esl-adapt-manifest.json')).outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'codex', identity: '@scope/my-skill', directoryName: 'scope_my-skill' })
      ])
    );
  });

  it('reports a conflict and leaves an unmanifested project target untouched when identity differs', async () => {
    writeSkill(path.join(tmpDir, '.skills'), '@scope/my-skill');
    const targetDir = writeAdaptedTarget(path.join(tmpDir, '.agents', 'skills'), 'scope_my-skill', '@other/my-skill', 'other:my-skill');

    const result = await adaptProject(tmpDir, { homeDir });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'codex',
        conflicts: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill', targetDir }]
      })
    ]));
    expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toContain('name: other:my-skill');
  });

  it('prunes manifest-owned stale project output after identity verification', async () => {
    const skillsRoot = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    const staleTarget = writeAdaptedTarget(path.join(tmpDir, '.agents', 'skills'), 'scope_old-skill', '@scope/old-skill', 'scope:old-skill');
    fs.writeFileSync(
      path.join(skillsRoot, '.esl-adapt-manifest.json'),
      JSON.stringify({
        version: 1,
        outputs: [
          {
            tool: 'codex',
            identity: '@scope/old-skill',
            directoryName: 'scope_old-skill',
            displayName: 'scope:old-skill',
            targetDir: staleTarget
          }
        ]
      })
    );

    const result = await adaptProject(tmpDir, { homeDir, prune: true });

    expect(fs.existsSync(staleTarget)).toBe(false);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'codex',
        pruned: [{ identity: '@scope/old-skill', directoryName: 'scope_old-skill', targetDir: staleTarget }]
      })
    ]));
  });

  it('skips manifest-owned stale project output when identity verification fails', async () => {
    const skillsRoot = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    const staleTarget = writeAdaptedTarget(path.join(tmpDir, '.agents', 'skills'), 'scope_old-skill', '@other/old-skill', 'other:old-skill');
    fs.writeFileSync(
      path.join(skillsRoot, '.esl-adapt-manifest.json'),
      JSON.stringify({
        version: 1,
        outputs: [
          {
            tool: 'codex',
            identity: '@scope/old-skill',
            directoryName: 'scope_old-skill',
            displayName: 'scope:old-skill',
            targetDir: staleTarget
          }
        ]
      })
    );

    const result = await adaptProject(tmpDir, { homeDir, prune: true });

    expect(fs.existsSync(staleTarget)).toBe(true);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'codex',
        skipped: [{ identity: '@scope/old-skill', directoryName: 'scope_old-skill', targetDir: staleTarget }]
      })
    ]));
  });

  it('does not delete unmanifested project directories in prune mode', async () => {
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });
    const unrelatedDir = path.join(tmpDir, '.agents', 'skills', 'manual-skill');
    fs.mkdirSync(unrelatedDir, { recursive: true });
    fs.writeFileSync(path.join(unrelatedDir, 'SKILL.md'), '# Manual');

    await adaptProject(tmpDir, { homeDir, prune: true });

    expect(fs.readFileSync(path.join(unrelatedDir, 'SKILL.md'), 'utf8')).toBe('# Manual');
  });

  it('prunes manifest-owned project output for tools that are no longer configured', async () => {
    const skillsRoot = path.join(tmpDir, '.skills');
    fs.mkdirSync(skillsRoot, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.skills.json'), JSON.stringify({ tools: ['codex'] }));
    const staleTarget = writeAdaptedTarget(path.join(tmpDir, '.claude', 'skills'), 'scope_old-skill', '@scope/old-skill', 'scope:old-skill');
    fs.writeFileSync(
      path.join(skillsRoot, '.esl-adapt-manifest.json'),
      JSON.stringify({
        version: 1,
        outputs: [
          {
            tool: 'claude',
            identity: '@scope/old-skill',
            directoryName: 'scope_old-skill',
            displayName: 'scope:old-skill',
            targetDir: staleTarget
          }
        ]
      })
    );

    const result = await adaptProject(tmpDir, { homeDir, prune: true });

    expect(fs.existsSync(staleTarget)).toBe(false);
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: 'claude',
        pruned: [{ identity: '@scope/old-skill', directoryName: 'scope_old-skill', targetDir: staleTarget }]
      })
    ]));
  });

  it('throws when no tools are configured', async () => {
    await saveConfig({ tools: [] }, { homeDir });
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    await expect(adaptProject(tmpDir, { homeDir })).rejects.toThrow('No tools configured');
  });
});

describe('adaptGlobal', () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['codex'] }, { homeDir });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('copies global skills to namespaced runtime snapshots', async () => {
    writeSkill(path.join(homeDir, '.skill-library', 'skills'), '@scope/my-skill');

    const result = await adaptGlobal({ homeDir });

    expect(fs.readFileSync(path.join(homeDir, '.agents', 'skills', 'scope_my-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: scope:my-skill'
    );
    expect(result).toEqual([
      {
        tool: 'codex',
        skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }],
        adopted: [],
        pruned: [],
        skipped: [],
        conflicts: []
      }
    ]);
  });

  it('does not delete unrelated global tool skill directories during normal adapt', async () => {
    const unrelatedDir = path.join(homeDir, '.agents', 'skills', 'manual-skill');
    fs.mkdirSync(unrelatedDir, { recursive: true });
    fs.writeFileSync(path.join(unrelatedDir, 'SKILL.md'), '# Manual');

    await adaptGlobal({ homeDir });

    expect(fs.readFileSync(path.join(unrelatedDir, 'SKILL.md'), 'utf8')).toBe('# Manual');
  });

  it('writes an Adapt Manifest for global adapted outputs', async () => {
    writeSkill(path.join(homeDir, '.skill-library', 'skills'), '@scope/my-skill');

    await adaptGlobal({ homeDir });

    expect(readJson(path.join(homeDir, '.skill-library', '.esl-adapt-manifest.json'))).toEqual({
      version: 1,
      outputs: [
        {
          tool: 'codex',
          identity: '@scope/my-skill',
          directoryName: 'scope_my-skill',
          displayName: 'scope:my-skill',
          targetDir: path.join(homeDir, '.agents', 'skills', 'scope_my-skill')
        }
      ]
    });
  });
});
