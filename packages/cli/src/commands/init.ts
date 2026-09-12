import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createMinimalReleaseManifest, parseSkillName, validateSkillSourceDirectory } from '@esl/core';
import { isInteractive, readText } from '../prompt.js';

const execFileAsync = promisify(execFile);

export interface InitOptions {
  cwd?: string;
  runGitInit?: boolean;
  license?: string;
  keywords?: string[];
  description?: string;
  /** Skips every prompt and writes the template as-is. */
  noInput?: boolean;
  /** Injected by tests in place of the interactive prompt. */
  promptText?: (question: string, fallback: string) => Promise<string>;
}

/**
 * YAML frontmatter is line-oriented, so a description containing a colon, a
 * quote, or a leading special character has to be quoted to keep the generated
 * SKILL.md parseable.
 */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 .,;!?'()\-/]*$/.test(value) ? value : JSON.stringify(value);
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

  const defaultDescription = `Use when a user needs the ${folderName} workflow or domain guidance.`;
  let description = options.description ?? defaultDescription;
  let license = options.license ?? 'MIT';
  let keywords = options.keywords ?? [];

  // Interactive terminals get asked; scripts and --no-input keep the template.
  const ask = options.promptText ?? (isInteractive() ? readText : undefined);
  if (ask && !options.noInput) {
    if (options.description === undefined) {
      const answer = (await ask(`Description [${defaultDescription}]: `, defaultDescription)).trim();
      description = answer || defaultDescription;
    }
    if (options.license === undefined) {
      const answer = (await ask('License (SPDX) [MIT]: ', 'MIT')).trim();
      license = answer || 'MIT';
    }
    if (options.keywords === undefined) {
      const answer = (await ask('Keywords (comma separated) [none]: ', '')).trim();
      keywords = answer
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
    }
  }

  await fs.mkdir(targetDir, { recursive: true });

  const releaseJson = { ...createMinimalReleaseManifest(license), keywords };

  await fs.writeFile(path.join(targetDir, 'release.json'), `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(
    path.join(targetDir, 'SKILL.md'),
    `---
name: ${folderName}
description: ${yamlScalar(description)}
---

# ${folderName}

Write concise agent instructions here. Move long reference material into references/, reusable scripts into scripts/, and output templates or assets into assets/.
`,
    'utf8'
  );

  const validation = await validateSkillSourceDirectory(targetDir);
  if (!validation.success) {
    throw new Error(`Generated invalid skill source: ${validation.errors.join(', ')}`);
  }

  if (runGitInit) {
    await execFileAsync('git', ['init'], { cwd: targetDir });
  }

  return targetDir;
}
