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
      { tool: 'claude', skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }] },
      { tool: 'codex', skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }] }
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
    expect(result).toEqual([{ tool: 'trae', skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }] }]);
  });

  it('cleans tool directories before adapting', async () => {
    const staleDir = path.join(tmpDir, '.claude', 'skills', 'old-skill');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), '# Old');
    fs.mkdirSync(path.join(tmpDir, '.skills'), { recursive: true });

    await adaptProject(tmpDir, { homeDir });

    expect(fs.existsSync(staleDir)).toBe(false);
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
    expect(result).toEqual([{ tool: 'codex', skills: [{ identity: '@scope/my-skill', directoryName: 'scope_my-skill' }] }]);
  });
});
