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
            sourceDir: 'skills/@alice/code-review',
            installedAt: '2026-01-01T00:00:00.000Z'
          },
          '@local/my-helper': {
            identity: '@local/my-helper',
            version: '0.1.0',
            source: 'local',
            specifier: 'file:/tmp/my-helper',
            sourceDir: 'skills/@local/my-helper',
            installedAt: '2026-01-01T00:00:00.000Z'
          },
          '@builtin/esl-operator': {
            identity: '@builtin/esl-operator',
            version: '0.1.0',
            source: 'builtin',
            specifier: 'builtin:esl-operator',
            sourceDir: 'skills/@builtin/esl-operator',
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

  it('enriches entries with local displayName, tool links and linkSourcePath without network', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    const storeRoot = path.join(tmpDir, '.eslib');
    const skillDir = path.join(storeRoot, 'skills', '@alice', 'code-review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'release.json'),
      JSON.stringify({ schemaVersion: 4, name: '@alice/code-review', version: '1.0.0', license: 'MIT', displayName: 'Code Review', keywords: [], compatibility: {}, dependencies: {} })
    );
    await fs.writeFile(
      path.join(storeRoot, '.esl-install-manifest.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@alice/code-review': {
            identity: '@alice/code-review',
            version: '1.0.0',
            source: 'registry',
            specifier: '^1.0.0',
            sourceDir: 'skills/@alice/code-review',
            installedAt: '2026-01-01T00:00:00.000Z'
          },
          '@local/my-helper': {
            identity: '@local/my-helper',
            version: '0.1.0',
            source: 'link',
            specifier: 'link:../my-helper',
            resolved: '/tmp/my-helper',
            sourceDir: 'skills/@local/my-helper',
            installedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    );

    const results = await listSkills(storeRoot, { level: 'project', projectRoot: tmpDir });

    expect(results).toEqual([
      {
        name: '@alice/code-review',
        version: '1.0.0',
        source: 'registry',
        displayName: 'Code Review',
        tools: []
      },
      {
        name: '@local/my-helper',
        version: '0.1.0',
        source: 'link',
        linkSourcePath: '/tmp/my-helper',
        tools: []
      }
    ]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('summarizes per-skill tool links with status and managed flags', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    const storeRoot = path.join(tmpDir, '.eslib');
    const skillSource = path.join(storeRoot, 'skills', '@alice', 'code-review');
    await fs.mkdir(skillSource, { recursive: true });
    const toolDir = path.join(tmpDir, '.claude', 'skills', '@alice_code-review');
    await fs.mkdir(path.dirname(toolDir), { recursive: true });
    await fs.symlink(skillSource, toolDir, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(
      path.join(storeRoot, '.esl-install-manifest.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@alice/code-review': {
            identity: '@alice/code-review',
            version: '1.0.0',
            source: 'registry',
            specifier: '^1.0.0',
            sourceDir: 'skills/@alice/code-review',
            installedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    );
    await fs.writeFile(
      path.join(storeRoot, '.esl-tools-manifest.json'),
      JSON.stringify({
        version: 1,
        links: [
          {
            identity: '@alice/code-review',
            tool: 'claude',
            level: 'project',
            sourceDir: 'skills/@alice/code-review',
            targetDir: toolDir,
            createdAt: '2026-01-01T00:00:00.000Z'
          },
          {
            identity: '@alice/code-review',
            tool: 'codex',
            level: 'project',
            sourceDir: 'skills/@alice/code-review',
            targetDir: path.join(tmpDir, '.codex', 'skills', '@alice_code-review'),
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    );

    const results = await listSkills(storeRoot, { level: 'project', projectRoot: tmpDir });

    expect(results[0].tools).toEqual([
      { tool: 'claude', status: 'linked', managed: true },
      { tool: 'codex', status: 'broken', managed: true }
    ]);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('attributes unmanaged tool-directory content back to the skill via the ESL directory name', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-list-'));
    const storeRoot = path.join(tmpDir, '.eslib');
    const skillSource = path.join(storeRoot, 'skills', '@alice', 'code-review');
    await fs.mkdir(skillSource, { recursive: true });
    // 手工创建的目录（非 ESL 记录、非 symlink）：应作为 unmanaged 挂到该技能名下。
    // ESL 的 link 目录命名是 <scope>_<skill>（无 @ 前缀）。
    const handMade = path.join(tmpDir, '.claude', 'skills', 'alice_code-review');
    await fs.mkdir(handMade, { recursive: true });
    await fs.writeFile(path.join(handMade, 'SKILL.md'), 'stub');
    await fs.writeFile(
      path.join(storeRoot, '.esl-install-manifest.json'),
      JSON.stringify({
        version: 1,
        skills: {
          '@alice/code-review': {
            identity: '@alice/code-review',
            version: '1.0.0',
            source: 'registry',
            specifier: '^1.0.0',
            sourceDir: 'skills/@alice/code-review',
            installedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    );

    const results = await listSkills(storeRoot, { level: 'project', projectRoot: tmpDir });

    expect(results[0].tools).toEqual([
      { tool: 'claude', status: 'unmanaged', managed: false }
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
