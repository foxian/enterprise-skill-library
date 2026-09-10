import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { executeInfo } from './info.js';
import type { NetworkCommandOptions } from './network-options.js';
import { notify } from '../output.js';
import { confirm, isInteractive } from '../prompt.js';
import { fileExists } from '@esl/core';

const defaultExecFileAsync = promisify(execFile);

// ADR-0028：源链接重置（脱管）。把一个 Server-hosted Skill Source 目录还原为
// 未托管的本地源目录：仅做本地 git/文件操作——删除 Source Remote、把
// Release Manifest 改名备份。它绝不触碰服务器、绝不自动重新登记：重新
// upload 是用户显式的第二步骤，与 ADR-0021 的「两步显式确认」一致。
export interface ResetSourceOptions extends NetworkCommandOptions {
  directory?: string;
  force?: boolean;
  noInput?: boolean;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface ResetSourceResult {
  directory: string;
  remoteUrl: string;
  releaseManifestRenamedTo: string | null;
}

export async function executeResetSource(options: ResetSourceOptions = {}): Promise<ResetSourceResult> {
  const directory = options.directory ?? process.cwd();
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;

  let remoteUrl: string;
  try {
    remoteUrl = (await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory })).stdout.trim();
  } catch {
    throw new Error(
      `Skill source at ${directory} has no esl remote; it is already an un-managed local source and needs no reset`
    );
  }

  // 守门：Registry API 只读探测。身份在当前登录下可见时，服务器上的源仍在——
  // 脱管前的核实假设（「源已删除」）不成立。硬阻断（ADR-0028：避免误删），
  // 提示先核实；--force 显式表态「我知道源还在，就是要另立新源」才放行。
  if (options.force !== true && remoteUrl.startsWith('http')) {
    const identity = identityFromRemoteUrl(remoteUrl);
    if (identity) {
      try {
        await executeInfo(identity, options);
        throw new Error(
          `The skill identity ${identity} still exists on the configured ESL server; refusing to reset the source link. ` +
            'Verify on the server first: if you only switched accounts, log in with the maintaining account and "esl upload" to sync; ' +
            'if the source really should be deleted, have it deleted (Archived/Deleted Skill by the platform administrator). ' +
            'To proceed with a reset anyway - detaching locally and registering a brand-new source with a new Skill ID later - re-run with --force.'
        );
      } catch (error) {
        // 守门自身抛出的拒绝执行错误必须向上传递；其余探测失败（源已删除、
        // 无权限或网络不通）→ 按用户主张的脱管场景放行。
        if (error instanceof Error && error.message.includes('refusing to reset')) throw error;
      }
    }
  }

  if (options.force !== true) {
    if (options.noInput || !isInteractive()) {
      throw new Error(
        'Resetting the source link requires confirmation; pass --force to skip the confirmation in non-interactive runs'
      );
    }
    const confirmed = await confirm(`Remove the esl remote (${remoteUrl}) and reset this directory to a local skill source? [y/N] `);
    if (!confirmed) {
      throw new Error('Reset cancelled');
    }
  }

  const manifestPath = path.join(directory, 'release.json');
  const backupPath = `${path.join(directory, 'release.json')}.before-reset`;
  const hasManifest = await fileExists(manifestPath);
  if (hasManifest && (await fileExists(backupPath))) {
    // 破坏性前置检查：任何冲突都在动 remote 之前发现，绝不留下脱管一半的目录。
    throw new Error(
      `A previous reset backup already exists at ${backupPath}; remove or rename it, then re-run "esl reset-source"`
    );
  }

  await execFileAsync('git', ['remote', 'remove', 'esl'], { cwd: directory });

  let releaseManifestRenamedTo: string | null = null;
  if (hasManifest) {
    await fs.rename(manifestPath, backupPath);
    releaseManifestRenamedTo = backupPath;
    notify(`Release Manifest renamed to ${path.basename(backupPath)}`);
  }

  return { directory, remoteUrl, releaseManifestRenamedTo };
}

// 与 upload 的 skillNameFromRemote 相同的解析约定：取 /git/ 与 .git 之间的
// 组织/仓库路径并拼成 `@scope/name`。
function identityFromRemoteUrl(remoteUrl: string): string | null {
  const match = remoteUrl.match(/\/git\/(.+?)(?:\.git)?\/?$/);
  return match ? `@${match[1]}` : null;
}
