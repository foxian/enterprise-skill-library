import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 在缺少 git 的机器上给出可行动错误（ADR-0053）：报错必须指向安装与 PATH，
 * 而不是让底层 execFile 以 ENOENT 爆出难懂堆栈。
 */
export class GitMissingError extends Error {
  readonly code = 'cliGitMissing';

  constructor() {
    super(
      'Git is required for this command. Install git (on Windows: https://git-scm.com/download/win) and make sure it is on your PATH.'
    );
    this.name = 'GitMissingError';
  }
}

/**
 * 探测 git 是否在 PATH 中（Windows 用 where，其余平台用 which，与
 * compatibility 的探测方式一致）。默认探测真实 PATH；命令实现一律在第一个
 * git 操作之前调用，做到 fail-fast。
 */
export async function ensureGitAvailable(
  options: { execFileAsync?: typeof execFileAsync; platform?: string } = {}
): Promise<void> {
  const runner = options.execFileAsync ?? execFileAsync;
  const platform = options.platform ?? process.platform;
  try {
    await runner(platform === 'win32' ? 'where' : 'which', ['git']);
  } catch {
    throw new GitMissingError();
  }
}
