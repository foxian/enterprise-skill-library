import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSkills } from '@esl/core';

describe('esl list', () => {
  it('returns entries from lockfile when present', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    await fs.writeFile(
      path.join(tmpDir, '.skills-lock.json'),
      JSON.stringify({
        lockfileVersion: 1,
        skills: {
          '@alice/code-review': {
            version: '1.0.0',
            resolved: 'http://localhost:3000/git/esl-skills/alice_code-review.git',
            integrity: 'sha256-abc123'
          },
          '@local/my-helper': {
            version: '0.1.0',
            resolved: 'file:/tmp/my-helper',
            integrity: 'sha256-def456'
          },
          '@builtin/esl-operator': {
            identity: '@builtin/esl-operator',
            version: '0.1.0',
            resolved: 'builtin:esl-operator',
            integrity: 'sha256-abc123',
            source: 'builtin'
          }
        }
      })
    );

    const results = await listSkills(tmpDir);

    expect(results).toEqual([
      { name: '@alice/code-review', version: '1.0.0', source: 'registry' },
      { name: '@local/my-helper', version: '0.1.0', source: 'local' },
      { name: '@builtin/esl-operator', version: '0.1.0', source: 'builtin' }
    ]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('falls back to .skills.json when no lockfile exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    await fs.writeFile(
      path.join(tmpDir, '.skills.json'),
      JSON.stringify({
        skills: {
          '@bob/testing': '^2.0.0',
          '@local/draft': 'file:./draft'
        }
      })
    );

    const results = await listSkills(tmpDir);

    expect(results).toEqual([
      { name: '@bob/testing', version: '^2.0.0', source: 'registry' },
      { name: '@local/draft', version: 'file:./draft', source: 'local' }
    ]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('returns empty array when no skills are installed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));

    const results = await listSkills(tmpDir);

    expect(results).toEqual([]);
    await fs.rm(tmpDir, { recursive: true });
  });
});
