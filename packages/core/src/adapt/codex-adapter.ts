import os from 'node:os';
import path from 'node:path';
import { removeDirectory } from '../store/file-copy.js';
import { copyAdaptedSkill } from './adapted-skill-copy.js';
import type { AdaptedSkill, ToolAdapter } from './tool-adapter.js';

export class CodexAdapter implements ToolAdapter {
  readonly name = 'codex';

  projectDir(root: string): string {
    return path.join(root, '.agents', 'skills');
  }

  globalDir(homeDir = os.homedir()): string {
    return path.join(homeDir, '.agents', 'skills');
  }

  async adapt(skillSourceDir: string, skill: AdaptedSkill, targetBaseDir: string): Promise<void> {
    await copyAdaptedSkill(skillSourceDir, skill, targetBaseDir);
  }

  async clean(targetBaseDir: string): Promise<void> {
    await removeDirectory(targetBaseDir);
  }
}
