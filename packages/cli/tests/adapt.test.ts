import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, saveConfig } from '@esl/core';
import { executeAdapt, formatAdaptResults } from '../src/commands/adapt.js';
import { executeInstall } from '../src/commands/install.js';

describe('esl adapt', () => {
  it('formats source-to-runtime mappings', () => {
    expect(
      formatAdaptResults([
        {
          tool: 'codex',
          skills: [
            { identity: '@cnfox/code-review', directoryName: 'cnfox_code-review' },
            { identity: '@local/brainstorming', directoryName: 'local_brainstorming' }
          ],
          adopted: [],
          skipped: [],
          conflicts: [],
          failed: []
        }
      ])
    ).toEqual([
      'codex: 2 skill(s) synced (@cnfox/code-review -> cnfox_code-review, @local/brainstorming -> local_brainstorming)'
    ]);
  });

  it('formats adapt ownership outcomes', () => {
    expect(
      formatAdaptResults([
        {
          tool: 'codex',
          skills: [],
          adopted: [{ identity: '@cnfox/code-review', directoryName: 'cnfox_code-review' }],
          skipped: [{ identity: '@cnfox/skipped-skill', directoryName: 'cnfox_skipped-skill', targetDir: 'unused' }],
          conflicts: [{ identity: '@cnfox/conflict-skill', directoryName: 'cnfox_conflict-skill', targetDir: 'unused' }],
          failed: []
        }
      ])
    ).toEqual([
      'codex: 0 skill(s) synced (adopted: @cnfox/code-review -> cnfox_code-review; skipped: @cnfox/skipped-skill -> cnfox_skipped-skill; conflicts: @cnfox/conflict-skill -> cnfox_conflict-skill)'
    ]);
  });
});

describe('esl adapt project configuration', () => {
  let homeDir: string;
  let projectDir: string;
  let localSkillDir: string;

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-home-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-adapt-project-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['claude'] }, { homeDir });

    localSkillDir = path.join(projectDir, 'my-local-skill');
    fs.mkdirSync(localSkillDir);
    fs.writeFileSync(
      path.join(localSkillDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/my-local-skill',
        version: '0.2.0',
        description: 'A local test skill',
        author: 'tester'
      })
    );
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: my-local-skill\ndescription: Local test skill.\n---\n'
    );
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('uses project .skills.json tools from the project root', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });
    fs.writeFileSync(
      path.join(projectDir, '.skills.json'),
      JSON.stringify({ skills: {}, tools: ['cursor'] })
    );

    await executeAdapt({ directory: projectDir, homeDir });

    expect(
      fs.lstatSync(path.join(projectDir, '.cursor', 'skills', 'myorg_my-local-skill')).isSymbolicLink()
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, '.claude', 'skills', 'myorg_my-local-skill'))
    ).toBe(false);
  });

  it('rejects a configured legacy tool identifier', async () => {
    await executeInstall(localSkillDir, {
      projectRoot: projectDir,
      homeDir,
      noAdapt: true
    });
    fs.writeFileSync(
      path.join(projectDir, '.skills.json'),
      JSON.stringify({ skills: {}, tools: ['trae'] })
    );

    await expect(
      executeAdapt({ directory: projectDir, homeDir })
    ).rejects.toThrow('Unknown tool: trae');
  });
});
