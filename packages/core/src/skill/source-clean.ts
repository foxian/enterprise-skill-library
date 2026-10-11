import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists, removeDirectory } from '../store/file-copy.js';

const ESL_TRACE_FILES = [
  'release.json',
  'release.json.before-reset'
];

export interface CleanSourceOptions {
  directory?: string;
}

export interface CleanSourceResult {
  directory: string;
  removed: string[];
}

/**
 * 原地清除技能目录中的 Git 仓库与 ESL 清单痕迹，只保留技能文档与代码。
 * 不复制目录，也不触碰 SKILL.md、scripts、references 等技能正文。
 */
export async function executeCleanSource(options: CleanSourceOptions = {}): Promise<CleanSourceResult> {
  const directory = path.resolve(options.directory ?? process.cwd());
  const skillMd = path.join(directory, 'SKILL.md');
  if (!(await fileExists(skillMd))) {
    throw new Error(`Skill directory at ${directory} has no SKILL.md`);
  }

  const removed: string[] = [];
  const gitDir = path.join(directory, '.git');
  if (await fileExists(gitDir)) {
    await removeDirectory(gitDir);
    removed.push('.git');
  }

  for (const name of ESL_TRACE_FILES) {
    const target = path.join(directory, name);
    if (await fileExists(target)) {
      await fs.rm(target, { force: true });
      removed.push(name);
    }
  }

  if (removed.length === 0) {
    throw new Error(`Skill directory at ${directory} has no Git repository or ESL release manifest to clean`);
  }

  return { directory, removed };
}
