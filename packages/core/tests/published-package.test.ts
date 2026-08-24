import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparePublishedSkillPackage } from '../src/skill/published-package.js';

describe('Published Skill Package', () => {
  let root: string;
  let source: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-package-'));
    source = path.join(root, 'reviewer');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'skill.json'), JSON.stringify({
      name: '@platform-ai/reviewer',
      version: '1.0.0',
      description: 'Reviewer',
      author: 'alice'
    }));
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: reviewer\ndescription: Reviewer\n---\n');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('rewrites the package display name while leaving source short-name validation intact', async () => {
    await preparePublishedSkillPackage(source, '@platform-ai/reviewer');

    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toContain('name: platform-ai:reviewer');
    expect(JSON.parse(fs.readFileSync(path.join(source, 'skill.json'), 'utf8')).name)
      .toBe('@platform-ai/reviewer');
  });
});
