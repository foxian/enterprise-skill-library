import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInteractionRequiredError } from '@esl/core';
import {
  assertNotNestedConsumerStore,
  consumerProjectRootHint,
  hasHardEvidence,
  initializeConsumerProjectRoot,
  inspectConsumerProjectRoot,
  isLocalSkillSource,
  projectToolPointDirectories,
  resolveConsumerProjectRoot,
  resolveProjectRootSilently
} from '../src/commands/consumer-project-root.js';

function writeSkillSource(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    '---\nname: draft-skill\ndescription: Test skill.\n---\n\n# Draft\n'
  );
}

describe('consumer project root discovery', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-cpr-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('locks the project tool point directories to the Tool Link matrix', () => {
    expect(projectToolPointDirectories()).toEqual([
      '.claude',
      '.codex',
      '.cursor',
      '.trae',
      '.workbuddy',
      '.opencode',
      '.hermes'
    ]);
  });

  it('treats .skills.json or .eslib as hard evidence', async () => {
    const skillDir = path.join(root, 'skill');
    writeSkillSource(skillDir);
    expect(await hasHardEvidence(skillDir)).toBe(false);

    fs.writeFileSync(path.join(skillDir, '.skills.json'), '{"skills":{}}\n');
    expect(await hasHardEvidence(skillDir)).toBe(true);

    fs.rmSync(path.join(skillDir, '.skills.json'));
    fs.mkdirSync(path.join(skillDir, '.eslib'));
    expect(await hasHardEvidence(skillDir)).toBe(true);
  });

  it('only treats a valid SKILL.md directory as a Local Skill Source', async () => {
    const skillDir = path.join(root, 'skill');
    writeSkillSource(skillDir);
    expect(await isLocalSkillSource(skillDir)).toBe(true);
    expect(await isLocalSkillSource(path.join(skillDir, 'references'))).toBe(false);
    expect(await isLocalSkillSource(root)).toBe(false);
  });

  it('takes the parent with hard evidence silently', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.writeFileSync(path.join(farm, '.skills.json'), '{"skills":{}}\n');

    const inspection = await inspectConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir
    });

    expect(inspection).toEqual({ kind: 'hard', parent: farm, projectRoot: farm });
    await expect(
      resolveProjectRootSilently({ command: 'link', cwd: skillDir, candidateDir: skillDir })
    ).resolves.toBe(farm);
  });

  it('detects weak evidence from project tool point directories', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.codex'));

    const inspection = await inspectConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir
    });

    expect(inspection).toEqual({ kind: 'weak', parent: farm, toolDirs: ['.codex'] });
  });

  it('ignores OpenClaw bare skills/ as weak evidence', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, 'skills'));

    const inspection = await inspectConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir
    });

    expect(inspection).toEqual({ kind: 'none', parent: farm });
  });

  it('does not discover when cwd is not a Local Skill Source or already has evidence', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.writeFileSync(path.join(farm, '.skills.json'), '{"skills":{}}\n');
    fs.writeFileSync(path.join(skillDir, '.skills.json'), '{"skills":{}}\n');

    await expect(
      inspectConsumerProjectRoot({ command: 'link', cwd: skillDir, candidateDir: skillDir })
    ).resolves.toEqual({ kind: 'not-applicable', projectRoot: skillDir });

    await expect(
      inspectConsumerProjectRoot({ command: 'link', cwd: farm, candidateDir: skillDir })
    ).resolves.toEqual({ kind: 'not-applicable', projectRoot: farm });
  });

  it('does not discover for global or when an explicit different projectRoot is given', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.writeFileSync(path.join(farm, '.skills.json'), '{"skills":{}}\n');
    const other = path.join(root, 'other');

    await expect(
      inspectConsumerProjectRoot({ command: 'link', global: true, cwd: skillDir, candidateDir: skillDir })
    ).resolves.toEqual({ kind: 'not-applicable', projectRoot: skillDir });
    await expect(
      inspectConsumerProjectRoot({
        command: 'link',
        cwd: skillDir,
        candidateDir: skillDir,
        projectRoot: other
      })
    ).resolves.toEqual({ kind: 'not-applicable', projectRoot: other });
  });

  it('initializes the parent as a Consumer Project Root', async () => {
    const farm = path.join(root, 'farm');
    fs.mkdirSync(farm);

    await initializeConsumerProjectRoot(farm);

    expect(JSON.parse(fs.readFileSync(path.join(farm, '.skills.json'), 'utf8'))).toEqual({ skills: {} });
    expect(fs.statSync(path.join(farm, '.eslib', 'skills')).isDirectory()).toBe(true);
  });

  it('hints the parent Consumer Project Root for list/tools/uninstall', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.writeFileSync(path.join(farm, '.skills.json'), '{"skills":{}}\n');

    const hint = await consumerProjectRootHint({ cwd: skillDir });
    expect(hint).toContain(farm);
    expect(hint).toContain('-C');

    await expect(consumerProjectRootHint({ cwd: skillDir, global: true })).resolves.toBeNull();
    await expect(consumerProjectRootHint({ cwd: root })).resolves.toBeNull();
  });

  it('silently uses hard evidence but keeps cwd for weak or no evidence', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.codex'));

    await expect(
      resolveProjectRootSilently({ command: 'unlink', cwd: skillDir, candidateDir: skillDir })
    ).resolves.toBe(skillDir);
  });

  it('resolves weak evidence with a default-yes confirmation', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.claude'));

    const result = await resolveConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir,
      interactive: false,
      agentMode: false,
      params: { useParent: true }
    });

    expect(result).toEqual({ kind: 'project', projectRoot: farm });
  });

  it('falls through to the three-way choice when weak evidence is declined', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.claude'));

    const result = await resolveConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir,
      interactive: false,
      agentMode: false,
      params: { useParent: false, projectRootChoice: 'global' }
    });

    expect(result).toEqual({ kind: 'global' });
  });

  it('initializes the parent when the no-evidence choice is init', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);

    const result = await resolveConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir,
      interactive: false,
      agentMode: false,
      params: { projectRootChoice: 'init' }
    });

    expect(result).toEqual({ kind: 'project', projectRoot: farm });
    expect(fs.existsSync(path.join(farm, '.skills.json'))).toBe(true);
  });

  it('fails with an actionable error when no evidence and no input', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);

    await expect(
      resolveConsumerProjectRoot({
        command: 'link',
        cwd: skillDir,
        candidateDir: skillDir,
        interactive: false,
        agentMode: false
      })
    ).rejects.toMatchObject({ code: 'consumerProjectRootRequired' });
  });

  it('fails with a weak-evidence error that lists the tool directories', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.codex'));

    await expect(
      resolveConsumerProjectRoot({
        command: 'link',
        cwd: skillDir,
        candidateDir: skillDir,
        interactive: false,
        agentMode: false
      })
    ).rejects.toMatchObject({ code: 'consumerProjectRootWeakEvidenceRequired' });
    await expect(
      resolveConsumerProjectRoot({
        command: 'link',
        cwd: skillDir,
        candidateDir: skillDir,
        interactive: false,
        agentMode: false
      })
    ).rejects.toThrow(/\.codex/);
  });

  it('accepts the agent label as the no-evidence choice', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);

    const result = await resolveConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir,
      interactive: false,
      agentMode: false,
      params: {
        projectRootChoice: 'Use the global Skill Store instead'
      }
    });

    expect(result).toEqual({ kind: 'global' });
  });

  it('emits an agent interaction request for weak evidence and no evidence', async () => {
    const farm = path.join(root, 'farm');
    const skillDir = path.join(farm, 'draft-skill');
    writeSkillSource(skillDir);
    fs.mkdirSync(path.join(farm, '.trae'));

    const weakError = await resolveConsumerProjectRoot({
      command: 'link',
      cwd: skillDir,
      candidateDir: skillDir,
      interactive: false,
      agentMode: true
    }).catch((error: unknown) => error);
    expect(weakError).toBeInstanceOf(AgentInteractionRequiredError);
    expect(JSON.stringify((weakError as AgentInteractionRequiredError).request.fields)).toContain('.trae');

    const noneFarm = path.join(root, 'none-farm');
    const noneSkillDir = path.join(noneFarm, 'draft-skill');
    writeSkillSource(noneSkillDir);
    const noneError = await resolveConsumerProjectRoot({
      command: 'unlink',
      cwd: noneSkillDir,
      candidateDir: noneSkillDir,
      interactive: false,
      agentMode: true
    }).catch((error: unknown) => error);
    expect(noneError).toBeInstanceOf(AgentInteractionRequiredError);
    expect((noneError as AgentInteractionRequiredError).request.command).toBe('unlink');
  });

  it('refuses install/update inside an evidence-less Local Skill Source', async () => {
    const skillDir = path.join(root, 'draft-skill');
    writeSkillSource(skillDir);

    await expect(
      assertNotNestedConsumerStore({ command: 'install', projectRoot: skillDir, cwd: skillDir })
    ).rejects.toMatchObject({ code: 'consumerProjectRootNestedStoreRefused' });

    await expect(
      assertNotNestedConsumerStore({ command: 'update', global: true, projectRoot: skillDir, cwd: skillDir })
    ).resolves.toBeUndefined();

    fs.writeFileSync(path.join(skillDir, '.skills.json'), '{"skills":{}}\n');
    await expect(
      assertNotNestedConsumerStore({ command: 'install', projectRoot: skillDir, cwd: skillDir })
    ).resolves.toBeUndefined();
  });
});
