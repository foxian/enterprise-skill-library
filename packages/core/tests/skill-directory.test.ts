import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateSkillDirectory, validateSkillMd } from '../src/index.js';

describe('SKILL.md validation', () => {
  it('accepts required frontmatter fields', () => {
    const result = validateSkillMd(`---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`);

    expect(result.success).toBe(true);
  });

  it('rejects missing descriptions', () => {
    const result = validateSkillMd(`---
name: debugging-helper
---

# Debugging Helper
`);

    expect(result.success).toBe(false);
  });
});

describe('skill directory validation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'esl-skill-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a minimal runtime skill package', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/debugging-helper',
        version: '0.1.0',
        description: 'Systematic debugging skill',
        author: 'zhangsan'
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'SKILL.md'),
      `---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`
    );
    fs.mkdirSync(path.join(tmpDir, 'scripts'));
    fs.mkdirSync(path.join(tmpDir, 'references'));
    fs.mkdirSync(path.join(tmpDir, 'assets'));

    const result = await validateSkillDirectory(tmpDir);

    expect(result.success).toBe(true);
  });

  it('reports deprecated resources directory', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'skill.json'),
      JSON.stringify({
        name: '@myorg/debugging-helper',
        version: '0.1.0',
        description: 'Systematic debugging skill',
        author: 'zhangsan'
      })
    );
    fs.writeFileSync(
      path.join(tmpDir, 'SKILL.md'),
      `---
name: debugging-helper
description: Use when debugging failures, test regressions, stack traces, or unexplained behavior.
---

# Debugging Helper
`
    );
    fs.mkdirSync(path.join(tmpDir, 'resources'));

    const result = await validateSkillDirectory(tmpDir);

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('resources')])
    );
  });
});
