import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
  assertInsideBoundary,
  assertMaterializationLimits,
  assertPublicHost,
  collectFilesWithinBoundary,
  DEFAULT_FETCH_LIMITS,
  detectUnsupportedMechanisms,
  type FetchLimits,
  type HostLookup
} from '@esl/core';
import type { ByteFileMap } from '@esl/core';
import { assertPublicHttpsGitUrl } from '@esl/core';

const execFileAsync = promisify(execFile);

// 外部 Git 抓取的网络安全（ADR-0074）：显式禁用 HTTP 重定向（避免逐跳校验缺口）
// 与凭据助手（不转发平台凭据），并在任何网络访问前解析主机名、校验全部地址为公网。
const GIT_NETWORK_CONFIG = [
  '-c', 'http.followRedirects=false',
  '-c', 'credential.helper=',
  '-c', 'core.askPass='
];

// 外部 Git 抓取器（ADR-0074）：只用 git 读取数据，不执行上游脚本、不安装依赖、
// 不抓取子模块/LFS。本地文件路径模式用于测试；生产传入 https URL 并经 SSRF 校验。
export class ExternalGitFetchError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'ExternalGitFetchError';
  }
}

export interface FetcherOptions {
  workRoot: string;
  fetchTimeoutMs?: number;
  limits?: FetchLimits;
  // 注入 git 执行器与主机解析，便于测试；默认走真实 shell git 与系统 DNS。
  runGit?: (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>;
  lookup?: HostLookup;
}

export interface FetchInput {
  repositoryUrl: string;
  branch: string;
  // 技能目录相对仓库根；'' 表示仓库根。
  skillDirectory: string;
  // 已确认的目录外许可/署名文件（相对仓库根）。
  extraFiles: string[];
}

export interface FetchResult {
  commit: string;
  files: ByteFileMap;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class ExternalGitFetcher {
  private readonly limits: FetchLimits;
  private readonly fetchTimeoutMs: number;

  constructor(private readonly options: FetcherOptions) {
    this.limits = options.limits ?? DEFAULT_FETCH_LIMITS;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async run(
    args: string[],
    cwd?: string,
    extraConfig: string[] = []
  ): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = [...GIT_NETWORK_CONFIG, ...extraConfig, ...args];
    if (this.options.runGit) return this.options.runGit(fullArgs, cwd);
    try {
      return await execFileAsync('git', fullArgs, {
        cwd,
        timeout: this.fetchTimeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
    } catch (error) {
      throw this.mapGitError(error);
    }
  }

  private mapGitError(error: unknown): ExternalGitFetchError {
    const err = error as { stderr?: string; message?: string; killed?: boolean };
    const detail = (err.stderr || err.message || '').toString();
    if (err.killed) {
      return new ExternalGitFetchError('External fetch timed out', 'externalSourceFetchTimeout');
    }
    if (/remote branch .* not found|couldn't find remote ref|fatal: invalid reference|unknown declaration|远程分支[^\n]*未发现|未发现[^\n]*远程分支/i.test(detail)) {
      return new ExternalGitFetchError('Tracking branch not found upstream', 'externalSourceBranchNotFound');
    }
    if (/not a git repository|repository .* not found|could not read/i.test(detail)) {
      return new ExternalGitFetchError('Upstream repository not found', 'externalSourceRepositoryNotFound');
    }
    return new ExternalGitFetchError(detail || 'Git operation failed', 'externalSourceFetchFailed');
  }

  // 读取远程 HEAD 指向的具体默认分支名（创建时锁定，避免上游之后改默认分支）。
  async resolveDefaultBranch(repositoryUrl: string): Promise<string> {
    const config = await this.guardUrl(repositoryUrl);
    const { stdout } = await this.run(['ls-remote', '--symref', repositoryUrl, 'HEAD'], undefined, config);
    const match = stdout.match(/ref:\s*refs\/heads\/([^\t\n]+)\s*HEAD/);
    if (!match) {
      throw new ExternalGitFetchError('Could not resolve upstream default branch', 'externalSourceDefaultBranch');
    }
    return match[1].trim();
  }

  // https URL 经 SSRF 守卫（协议/凭据 + DNS/IP 公网校验）；http 直接拒绝；本地路径
  // （测试/离线）允许直接使用。返回 git 网络配置（固定解析地址可防 DNS rebinding）。
  private async guardUrl(repositoryUrl: string): Promise<string[]> {
    if (!/^https:\/\//i.test(repositoryUrl)) {
      if (/^\w+?:\/\//i.test(repositoryUrl)) {
        throw new ExternalGitFetchError(
          'Only public HTTPS repositories are supported',
          'externalSourceHttpsRequired'
        );
      }
      return [];
    }
    let url: URL;
    try {
      url = assertPublicHttpsGitUrl(repositoryUrl);
    } catch (error) {
      throw new ExternalGitFetchError((error as Error).message, (error as { code: string }).code);
    }
    const lookup = this.options.lookup ?? (async (hostname: string) => {
      const records = await dns.lookup(hostname, { all: true });
      return records.map((record) => record.address);
    });
    try {
      // 解析并校验全部地址为公网；后续 git 通过 curloptResolve 固定到首个 IPv4，
      // 使实际连接地址与校验地址一致，封堵 DNS rebinding 窗口。
      await assertPublicHost(url.hostname, lookup);
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''));
      const ipv4 = addresses.find((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address));
      if (!ipv4) return [];
      return ['-c', `http.curloptResolve=${url.hostname}:443:${ipv4}`];
    } catch (error) {
      throw new ExternalGitFetchError((error as Error).message, (error as { code: string }).code);
    }
  }

  async fetch(input: FetchInput): Promise<FetchResult> {
    const networkConfig = await this.guardUrl(input.repositoryUrl);
    const checkoutDir = path.join(this.options.workRoot, randomUUID());
    await fs.mkdir(checkoutDir, { recursive: true });

    // 浅克隆单分支：不拉子模块（无 --recurse-submodules），不触达 LFS。
    await this.run(
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--branch',
        input.branch,
        input.repositoryUrl,
        checkoutDir
      ],
      undefined,
      networkConfig
    );

    const commit = (await this.run(['rev-parse', 'HEAD'], checkoutDir)).stdout.trim();

    const skillDirectory = this.resolveSkillDirectory(checkoutDir, input.skillDirectory);
    const boundary = path.join(checkoutDir, skillDirectory);
    const boundaryStat = await fs.stat(boundary).catch(() => null);
    if (!boundaryStat || !boundaryStat.isDirectory()) {
      throw new ExternalGitFetchError(
        `Skill directory not found upstream: ${input.skillDirectory || '/'}`,
        'externalSourceDirectoryNotFound'
      );
    }
    const files = await collectFilesWithinBoundary(boundary);

    // 目录外确认文件：逐个校验仍在仓库内（不能越界），按仓库相对路径加入。
    for (const extra of input.extraFiles) {
      const normalizedExtra = this.normalizeExtraPath(extra);
      const extraAbsolute = path.join(checkoutDir, normalizedExtra);
      assertInsideBoundary(checkoutDir, extraAbsolute);
      const real = await fs.realpath(extraAbsolute).catch(() => {
        throw new ExternalGitFetchError(
          `Confirmed file not found upstream: ${normalizedExtra}`,
          'externalSourceExtraFileNotFound'
        );
      });
      assertInsideBoundary(checkoutDir, real);
      files[normalizedExtra] = await fs.readFile(extraAbsolute);
    }

    // 不支持机制：子模块 / LFS 出现即失败。
    const findings = detectUnsupportedMechanisms(checkoutDir, files);
    if (findings.length > 0) {
      throw new ExternalGitFetchError(findings[0].message, findings[0].code);
    }
    assertMaterializationLimits(files, this.limits);

    return { commit, files };
  }

  private normalizeExtraPath(extra: string): string {
    const cleaned = extra.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = cleaned.split('/').filter((part) => part.length > 0 && part !== '.');
    if (parts.some((part) => part === '..')) {
      throw new ExternalGitFetchError(
        `Confirmed file escapes the repository: ${extra}`,
        'externalSourcePathTraversal'
      );
    }
    return parts.join('/');
  }

  private resolveSkillDirectory(checkoutDir: string, skillDirectory: string): string {
    const cleaned = (skillDirectory || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = cleaned.split('/').filter((part) => part.length > 0 && part !== '.');
    if (parts.some((part) => part === '..')) {
      throw new ExternalGitFetchError('Skill directory escapes the repository', 'externalSourcePathTraversal');
    }
    return parts.join(path.sep);
  }
}
