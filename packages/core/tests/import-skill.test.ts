import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareSkillImport } from '../src/index.js';

describe('prepareSkillImport', () => {
  let tmpRoot: string;
  let skillDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-import-core-'));
    skillDir = path.join(tmpRoot, 'brainstorming');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Explore ideas before implementation.\n---\n\n# Brainstorming\n'
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates minimal skill.json with the local namespace by default', async () => {
    const result = await prepareSkillImport(skillDir, { author: 'tester' });

    expect(result).toEqual({
      directory: path.resolve(skillDir),
      skillName: '@local/brainstorming',
      createdSkillJson: true
    });
    expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8'))).toEqual({
      name: '@local/brainstorming',
      version: '0.1.0',
      description: 'Explore ideas before implementation.',
      author: 'tester',
      keywords: []
    });
  });

  it('uses an explicit namespace without changing the skill short name', async () => {
    await prepareSkillImport(skillDir, { namespace: 'cnfox', author: 'tester' });

    const skillJson = JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8'));
    expect(skillJson.name).toBe('@cnfox/brainstorming');
  });

  it('does not overwrite an existing matching skill.json', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@local/brainstorming',
        version: '2.0.0',
        description: 'Existing description',
        author: 'existing',
        keywords: ['kept']
      })
    );

    const result = await prepareSkillImport(skillDir, { author: 'tester' });

    expect(result.createdSkillJson).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8')).version).toBe('2.0.0');
  });

  it('rejects an existing skill.json with a mismatched namespace', async () => {
    fs.writeFileSync(
      path.join(skillDir, 'skill.json'),
      JSON.stringify({
        name: '@other/brainstorming',
        version: '0.1.0',
        description: 'Existing description',
        author: 'existing'
      })
    );

    await expect(prepareSkillImport(skillDir, { namespace: 'cnfox' })).rejects.toThrow(
      'skill.json name "@other/brainstorming" must match import name "@cnfox/brainstorming"'
    );
  });

  it('rejects an invalid namespace', async () => {
    await expect(prepareSkillImport(skillDir, { namespace: 'Bad_Name' })).rejects.toThrow(
      'Namespace must use lowercase letters, digits, and hyphens'
    );
  });

  it('rejects invalid SKILL.md frontmatter', async () => {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Missing frontmatter\n');

    await expect(prepareSkillImport(skillDir)).rejects.toThrow('SKILL.md: missing YAML frontmatter');
  });
});
