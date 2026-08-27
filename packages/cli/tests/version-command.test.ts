import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeInit, executeVersion } from '../src/index.js';

describe('esl version', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-command-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bumps the version of a package-form skill.json', async () => {
    const skillDir = path.join(tmpDir, 'my-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-skill',
        version: '0.1.0',
        description: 'Test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: Test skill.\n---\n');

    await expect(executeVersion('minor', { cwd: skillDir })).resolves.toBe('0.2.0');
  });

  it('rejects versioning a source-form directory and guides to esl publish <version>', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeVersion('patch', { cwd: skillDir })).rejects.toThrow(
      'source-form skill does not store a version; pass the version to esl publish <version>'
    );
  });
});