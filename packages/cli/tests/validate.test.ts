import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit, executeValidate } from '../src/index.js';

describe('esl validate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-validate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports valid generated source-form skills', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeValidate(skillDir)).resolves.toEqual({ valid: true, errors: [] });
  });

  it('reports invalid source-form skills', async () => {
    const skillDir = path.join(tmpDir, 'bad-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'release.json'), '{}');
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: bad-skill\ndescription: Bad.\n---\n');

    const result = await executeValidate(skillDir);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('schemaVersion');
  });

  it('reports invalid directories with no manifest', async () => {
    const result = await executeValidate(tmpDir);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('release.json');
  });

  it('does not require skill.json for a source-form directory', async () => {
    const skillDir = path.join(tmpDir, 'src-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'release.json'),
      JSON.stringify({
        schemaVersion: 1,
        license: 'MIT',
        keywords: [],
        compatibility: {},
        dependencies: {}
      })
    );
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: src-skill\ndescription: Src skill.\n---\n');

    await expect(executeValidate(skillDir)).resolves.toEqual({ valid: true, errors: [] });
  });
});