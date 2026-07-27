import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpSkillVersion } from '../src/index.js';

describe('skill version bumping', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-version-'));
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-skill',
        version: '1.2.3',
        description: 'My skill',
        author: 'zhangsan'
      })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bumps patch versions', async () => {
    await expect(bumpSkillVersion(tmpDir, 'patch')).resolves.toBe('1.2.4');
  });

  it('bumps minor versions and resets patch', async () => {
    await expect(bumpSkillVersion(tmpDir, 'minor')).resolves.toBe('1.3.0');
  });

  it('bumps major versions and resets minor and patch', async () => {
    await expect(bumpSkillVersion(tmpDir, 'major')).resolves.toBe('2.0.0');
  });
});
