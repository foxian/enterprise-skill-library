import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  highestStableVersion,
  isBuiltinIdentity,
  loadBuiltinPackageOrThrow,
  removeDirectory
} from '@esl/core';
import {
  gitAuthHeaderConfig,
  requireConfigured,
  requireFreshToken,
  type NetworkCommandOptions
} from './network-options.js';
import { executeInfo } from './info.js';
import { resolveBuiltinDir } from '../builtin-dir.js';

const defaultExecFileAsync = promisify(execFile);

export interface UseOptions extends NetworkCommandOptions {
  version?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

function isLocalPath(nameOrPath: string): boolean {
  return nameOrPath.startsWith('.') || nameOrPath.startsWith('/') || nameOrPath.startsWith('\\') || path.isAbsolute(nameOrPath);
}

async function readSkillMdFromLocal(sourcePath: string): Promise<string> {
  const resolved = path.resolve(sourcePath);
  const skillMdPath = path.join(resolved, 'SKILL.md');
  return fs.readFile(skillMdPath, 'utf8');
}

async function readSkillMdFromServer(name: string, options: UseOptions): Promise<string> {
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authToken = await requireFreshToken(options);
  const info = await executeInfo(name, options);
  const remoteUrl = requireConfigured(info.cloneUrl, 'cloneUrl');
  const authHeader = gitAuthHeaderConfig(authToken);
  const version = options.version ?? highestStableVersion(info.versions ?? []);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-use-'));
  try {
    const cloneDir = path.join(tmpDir, 'repo');
    await execFileAsync('git', ['-c', authHeader, 'clone', '--depth', '1', remoteUrl, cloneDir]);
    if (version) {
      await execFileAsync('git', ['checkout', version], { cwd: cloneDir });
    }
    return fs.readFile(path.join(cloneDir, 'SKILL.md'), 'utf8');
  } finally {
    await removeDirectory(tmpDir);
  }
}

async function readSkillMdFromBuiltin(name: string, options: UseOptions): Promise<string> {
  const builtinDir = options.builtinDir ?? resolveBuiltinDir();
  const builtin = await loadBuiltinPackageOrThrow(builtinDir, name);
  return fs.readFile(path.join(builtin.directory, 'SKILL.md'), 'utf8');
}

export async function executeUse(nameOrPath: string, options: UseOptions = {}): Promise<string> {
  if (isBuiltinIdentity(nameOrPath)) {
    return readSkillMdFromBuiltin(nameOrPath, options);
  }
  return isLocalPath(nameOrPath)
    ? readSkillMdFromLocal(nameOrPath)
    : readSkillMdFromServer(nameOrPath, options);
}
