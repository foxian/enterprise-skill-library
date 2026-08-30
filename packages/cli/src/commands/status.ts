import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitAuthHeaderConfig, requireFreshToken, type NetworkCommandOptions } from './network-options.js';

const defaultExecFileAsync = promisify(execFile);

export interface StatusOptions extends NetworkCommandOptions {
  directory?: string;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface SourceStatus {
  serverHosted: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
  lastCommit?: string;
}

export async function executeStatus(options: StatusOptions = {}): Promise<SourceStatus> {
  const directory = options.directory ?? process.cwd();
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;

  if (!(await isInsideWorkTree(execFileAsync, directory))) {
    return { serverHosted: false, clean: true, ahead: 0, behind: 0 };
  }
  if (!(await hasEslRemote(execFileAsync, directory))) {
    return { serverHosted: false, clean: true, ahead: 0, behind: 0 };
  }

  // Refresh the server-side ref when logged in, so ahead/behind are accurate
  // even when another maintainer pushed in the meantime.
  try {
    const token = await requireFreshToken(options);
    await execFileAsync('git', ['-c', gitAuthHeaderConfig(token), 'fetch', 'esl'], { cwd: directory });
  } catch {
    // Not logged in or server unreachable; fall back to the last local sync.
  }

  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: directory });
  const clean = !status.stdout.trim();

  let ahead = 0;
  let behind = 0;
  try {
    ahead = parseInt(
      (await execFileAsync('git', ['rev-list', '--count', 'esl/main..HEAD'], { cwd: directory })).stdout.trim() || '0',
      10
    );
    behind = parseInt(
      (await execFileAsync('git', ['rev-list', '--count', 'HEAD..esl/main'], { cwd: directory })).stdout.trim() || '0',
      10
    );
  } catch {
    // esl/main may not exist yet (the source was never pushed).
  }

  let lastCommit: string | undefined;
  try {
    const log = await execFileAsync('git', ['log', '-1', '--format=%h %s'], { cwd: directory });
    lastCommit = log.stdout.trim() || undefined;
  } catch {
    // no commits yet
  }

  return { serverHosted: true, clean, ahead, behind, lastCommit };
}

async function isInsideWorkTree(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string
): Promise<boolean> {
  try {
    const res = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory });
    return res.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function hasEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string
): Promise<boolean> {
  try {
    const res = await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory });
    return res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
