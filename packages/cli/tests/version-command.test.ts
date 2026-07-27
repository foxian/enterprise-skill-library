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

  it('bumps the current skill package version', async () => {
    const skillDir = await executeInit('@myorg/my-skill', { cwd: tmpDir, runGitInit: false });

    await expect(executeVersion('minor', { cwd: skillDir })).resolves.toBe('0.2.0');
  });
});
