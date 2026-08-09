import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeUse } from '../src/commands/use.js';

describe('esl use', () => {
  it('reads SKILL.md from a local directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
    const skillContent = '---\nname: test-skill\ndescription: A test skill.\n---\n\n# Test Skill\n\nDo the thing.\n';
    await fs.writeFile(path.join(tmpDir, 'SKILL.md'), skillContent);

    const result = await executeUse(tmpDir);

    expect(result).toBe(skillContent);
    await fs.rm(tmpDir, { recursive: true });
  });

  it('throws when SKILL.md is missing from local directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));

    await expect(executeUse(tmpDir)).rejects.toThrow();
    await fs.rm(tmpDir, { recursive: true });
  });

  it('reads SKILL.md using a path starting with dot', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
    const subDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(subDir);
    const skillContent = '---\nname: relative-skill\ndescription: Relative path test.\n---\n\nInstructions here.\n';
    await fs.writeFile(path.join(subDir, 'SKILL.md'), skillContent);

    const result = await executeUse(subDir);
    expect(result).toBe(skillContent);
    await fs.rm(tmpDir, { recursive: true });
  });
});
