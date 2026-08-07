import os from 'node:os';
import path from 'node:path';
import { copySkillDirectory, removeDirectory } from '../store/file-copy.js';
import type { ToolAdapter } from './tool-adapter.js';

export class TraeCnAdapter implements ToolAdapter {
  readonly name = 'trae-cn';

  projectDir(root: string): string {
    return path.join(root, '.trae', 'skills');
  }

  globalDir(): string {
    return path.join(os.homedir(), '.trae-cn', 'skills');
  }

  async adapt(skillSourceDir: string, skillName: string, targetBaseDir: string): Promise<void> {
    const targetDir = path.join(targetBaseDir, skillName);
    await copySkillDirectory(skillSourceDir, targetDir);
  }

  async clean(targetBaseDir: string): Promise<void> {
    await removeDirectory(targetBaseDir);
  }
}
