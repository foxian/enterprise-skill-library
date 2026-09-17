import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSkills } from '@esl/core';

describe('esl list', () => {
  it('returns entries from the install manifest', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    await fs.mkdir(path.join(tmpDir, '.eslib'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.eslib', '.esl-install-manifest.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@alice/code-review': {
            identity: '@alice/code-review',
            version: '1.0.0',
            source: 'registry',
            specifier: '^1.0.0',
            sourceDir: 'skills/alice_code-review',
            installedAt: '2026-01-01T00:00:00.000Z'
          },
          '@local/my-helper': {
            identity: '@local/my-helper',
            version: '0.1.0',
            source: 'local',
            specifier: 'file:/tmp/my-helper',
            sourceDir: 'skills/local_my-helper',
            installedAt: '2026-01-01T00:00:00.000Z'
          },
          '@builtin/esl-operator': {
            identity: '@builtin/esl-operator',
            version: '0.1.0',
            source: 'builtin',
            specifier: 'builtin:esl-operator',
            sourceDir: 'skills/builtin_esl-operator',
            installedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    );

    const results = await listSkills(path.join(tmpDir, '.eslib'));

    expect(results).toEqual([
      { name: '@alice/code-review', version: '1.0.0', source: 'registry' },
      { name: '@local/my-helper', version: '0.1.0', source: 'local' },
      { name: '@builtin/esl-operator', version: '0.1.0', source: 'builtin' }
    ]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('does not treat .skills.json as an installed source', async () => {
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

    expect(results).toEqual([]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('returns empty array when no skills are installed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));

    const results = await listSkills(tmpDir);

    expect(results).toEqual([]);
    await fs.rm(tmpDir, { recursive: true });
  });
});
