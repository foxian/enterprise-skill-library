import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseSkillName, validateSkillDirectory } from '@esl/core';

const execFileAsync = promisify(execFile);

export interface InitOptions {
  cwd?: string;
  runGitInit?: boolean;
}

export async function executeInit(skillName: string, options: InitOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const runGitInit = options.runGitInit ?? true;
  const { skillName: folderName } = parseSkillName(skillName);
  const targetDir = path.join(cwd, folderName);

  try {
    await fs.access(targetDir);
    throw new Error(`Directory ${folderName} already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.mkdir(targetDir, { recursive: true });

  const skillJson = {
    name: skillName,
    version: '0.1.0',
    description: `Runtime skill package for ${folderName}`,
    author: process.env.USER ?? process.env.USERNAME ?? 'anonymous',
    keywords: []
  };

  await fs.writeFile(path.join(targetDir, 'skill.json'), `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'SKILL.md'),
    `---
name: ${folderName}
description: Use when a user needs the ${folderName} workflow or domain guidance.
---

# ${folderName}

Write concise agent instructions here. Move long reference material into references/, reusable scripts into scripts/, and output templates or assets into assets/.
`,
    'utf8'
  );

  const validation = await validateSkillDirectory(targetDir);
  if (!validation.success) {
    throw new Error(`Generated invalid skill package: ${validation.errors.join(', ')}`);
  }

  if (runGitInit) {
    await execFileAsync('git', ['init'], { cwd: targetDir });
  }

  return targetDir;
}
