import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adaptProject } from '../src/adapt/adapt-engine.js';
import { initializeLocalStore, saveConfig } from '../src/store/local-store.js';

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

  it('copies skills from .skills/ to each tool directory', async () => {
    const skillDir = path.join(tmpDir, '.skills', '@scope', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@scope/my-skill',
        version: '1.0.0',
        description: 'Test',
        author: 'test'
      })
    );

    const result = await adaptProject(tmpDir, { homeDir });

    expect(fs.readFileSync(path.join(tmpDir, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(
      '# My Skill'
    );
    expect(fs.readFileSync(path.join(tmpDir, '.agents', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(
      '# My Skill'
    );
    expect(fs.existsSync(path.join(tmpDir, '.trae', 'skills', 'my-skill'))).toBe(false);

    expect(result).toEqual([
      { tool: 'claude', skills: ['my-skill'] },
      { tool: 'codex', skills: ['my-skill'] }
    ]);
  });

  it('respects project-level tools override', async () => {
    const skillDir = path.join(tmpDir, '.skills', '@scope', 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill');
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@scope/my-skill',
        version: '1.0.0',
        description: 'Test',
        author: 'test'
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.skills.json'),
      JSON.stringify({ skills: { '@scope/my-skill': '^1.0.0' }, tools: ['trae'] })
    );

    const result = await adaptProject(tmpDir, { homeDir });

    expect(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'my-skill'))).toBe(false);
    expect(fs.readFileSync(path.join(tmpDir, '.trae', 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toBe(
      '# My Skill'
    );
    expect(result).toEqual([{ tool: 'trae', skills: ['my-skill'] }]);
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
