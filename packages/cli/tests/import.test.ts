import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeLocalStore, loadSkillsJson, saveConfig } from '@esl/core';
import { executeImport } from '../src/index.js';

describe('esl import', () => {
  let projectDir: string;
  let homeDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-project-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-home-'));
    await initializeLocalStore({ homeDir });
    await saveConfig({ tools: ['codex'] }, { homeDir });
    sourceDir = path.join(projectDir, 'brainstorming');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(
      path.join(sourceDir, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Explore ideas before implementation.\n---\n\n# Brainstorming\n'
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('creates skill.json and installs the skill into project .skills with the local namespace', async () => {
    const result = await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    const expectedTarget = path.join(projectDir, '.skills', '@local', 'brainstorming');
    expect(result).toEqual({
      skillName: '@local/brainstorming',
      sourceDir: path.resolve(sourceDir),
      targetDir: expectedTarget,
      createdSkillJson: true
    });
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'skill.json'), 'utf8')).name).toBe(
      '@local/brainstorming'
    );
    expect(fs.existsSync(path.join(expectedTarget, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(expectedTarget, 'skill.json'))).toBe(true);

    const skillsJson = await loadSkillsJson(projectDir);
    expect(skillsJson.skills['@local/brainstorming']).toBe(`file:${path.resolve(sourceDir)}`);
  });

  it('uses an explicit namespace for the installed project path', async () => {
    const result = await executeImport(sourceDir, {
      namespace: 'cnfox',
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    expect(result.skillName).toBe('@cnfox/brainstorming');
    expect(result.targetDir).toBe(path.join(projectDir, '.skills', '@cnfox', 'brainstorming'));
  });

  it('runs adapt by default', async () => {
    await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester'
    });

    const adaptedSkillMd = path.join(projectDir, '.agents', 'skills', 'local_brainstorming', 'SKILL.md');
    expect(fs.readFileSync(adaptedSkillMd, 'utf8')).toContain('name: local:brainstorming');
  });

  it('does not adapt when noAdapt is true', async () => {
    await executeImport(sourceDir, {
      projectRoot: projectDir,
      homeDir,
      author: 'tester',
      noAdapt: true
    });

    expect(fs.existsSync(path.join(projectDir, '.agents'))).toBe(false);
  });
});
