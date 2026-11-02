import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExternalGitFetcher } from '../src/services/external-git-fetcher.js';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], { cwd });
}

async function makeUpstreamRepo(): Promise<{ root: string; dir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-up-'));
  const dir = path.join(root, 'upstream.git');
  await fs.mkdir(dir, { recursive: true });
  await git(['init', '-b', 'main'], dir);
  await fs.mkdir(path.join(dir, 'webapp-testing'), { recursive: true });
  await fs.writeFile(path.join(dir, 'webapp-testing', 'SKILL.md'), '---\nname: webapp-testing\ndescription: Up\n---\n# hi\n');
  await fs.writeFile(path.join(dir, 'webapp-testing', 'note.txt'), 'v1');
  await fs.writeFile(path.join(dir, 'LICENSE'), 'MIT License\n\nPermission is hereby granted, free of charge\n');
  await git(['add', '.'], dir);
  await git(['commit', '-m', 'initial'], dir);
  return { root, dir };
}

describe('ExternalGitFetcher', () => {
  let workRoot: string;
  let upstream: { root: string; dir: string };

  beforeEach(async () => {
    workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-fetch-work-'));
    upstream = await makeUpstreamRepo();
  });

  afterEach(async () => {
    await fs.rm(workRoot, { recursive: true, force: true });
    await fs.rm(upstream.root, { recursive: true, force: true });
  });

  it('解析默认分支名并抓取指定目录内容', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    const resolved = await fetcher.resolveDefaultBranch(upstream.dir);
    expect(resolved).toBe('main');

    const result = await fetcher.fetch({
      repositoryUrl: upstream.dir,
      branch: 'main',
      skillDirectory: 'webapp-testing',
      extraFiles: []
    });
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(result.files).sort()).toEqual(['SKILL.md', 'note.txt']);
    expect(result.files['SKILL.md'].toString('utf8')).toContain('webapp-testing');
  });

  it('支持仓库根目录作为技能目录', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    const result = await fetcher.fetch({
      repositoryUrl: upstream.dir,
      branch: 'main',
      skillDirectory: '',
      extraFiles: []
    });
    expect(Object.keys(result.files)).not.toContain('SKILL.md'); // 根下没有 SKILL.md
    expect(Object.keys(result.files)).toContain('LICENSE');
  });

  it('纳入明确确认的目录外许可文件并保留相对仓库路径', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    const result = await fetcher.fetch({
      repositoryUrl: upstream.dir,
      branch: 'main',
      skillDirectory: 'webapp-testing',
      extraFiles: ['LICENSE']
    });
    expect(Object.keys(result.files).sort()).toEqual(['LICENSE', 'SKILL.md', 'note.txt']);
  });

  it('上游更新后返回新的 commit 与内容', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    const first = await fetcher.fetch({
      repositoryUrl: upstream.dir,
      branch: 'main',
      skillDirectory: 'webapp-testing',
      extraFiles: []
    });
    await fs.writeFile(path.join(upstream.dir, 'webapp-testing', 'note.txt'), 'v2');
    await git(['add', '.'], upstream.dir);
    await git(['commit', '-m', 'update'], upstream.dir);
    const second = await fetcher.fetch({
      repositoryUrl: upstream.dir,
      branch: 'main',
      skillDirectory: 'webapp-testing',
      extraFiles: []
    });
    expect(second.commit).not.toBe(first.commit);
    expect(second.files['note.txt'].toString('utf8')).toBe('v2');
  });

  it('分支不存在时失败', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    await expect(
      fetcher.fetch({ repositoryUrl: upstream.dir, branch: 'nope', skillDirectory: '', extraFiles: [] })
    ).rejects.toMatchObject({ code: 'externalSourceBranchNotFound' });
  });

  it('目录不存在时失败', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    await expect(
      fetcher.fetch({ repositoryUrl: upstream.dir, branch: 'main', skillDirectory: 'missing', extraFiles: [] })
    ).rejects.toMatchObject({ code: 'externalSourceDirectoryNotFound' });
  });

  it('目录包含越界路径的 extraFiles 被拒绝', async () => {
    const fetcher = new ExternalGitFetcher({ workRoot });
    await expect(
      fetcher.fetch({
        repositoryUrl: upstream.dir,
        branch: 'main',
        skillDirectory: 'webapp-testing',
        extraFiles: ['../secret']
      })
    ).rejects.toMatchObject({ code: 'externalSourcePathTraversal' });
  });

  it('拒绝指向私网/云元数据的 https 字面量地址，且不执行 git', async () => {
    let gitCalled = false;
    const fetcher = new ExternalGitFetcher({
      workRoot,
      runGit: async () => {
        gitCalled = true;
        return { stdout: '', stderr: '' };
      }
    });
    await expect(
      fetcher.fetch({
        repositoryUrl: 'https://169.254.169.254/latest/meta-data',
        branch: 'main',
        skillDirectory: '',
        extraFiles: []
      })
    ).rejects.toMatchObject({ code: 'externalSourceForbiddenAddress' });
    expect(gitCalled).toBe(false);
  });

  it('域名解析到私网地址时拒绝', async () => {
    let gitCalled = false;
    const fetcher = new ExternalGitFetcher({
      workRoot,
      lookup: async () => ['10.0.0.7'],
      runGit: async () => {
        gitCalled = true;
        return { stdout: '', stderr: '' };
      }
    });
    await expect(
      fetcher.fetch({
        repositoryUrl: 'https://internal.example/repo.git',
        branch: 'main',
        skillDirectory: '',
        extraFiles: []
      })
    ).rejects.toMatchObject({ code: 'externalSourceForbiddenAddress' });
    expect(gitCalled).toBe(false);
  });

  it('解析到公网地址时通过 DNS 校验并固定连接地址', async () => {
    const calls: string[][] = [];
    const fetcher = new ExternalGitFetcher({
      workRoot,
      lookup: async () => ['140.82.112.3'],
      runGit: async (args) => {
        calls.push(args);
        if (args.includes('ls-remote')) {
          return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      }
    });
    await expect(fetcher.resolveDefaultBranch('https://github.com/anthropics/skills.git')).resolves.toBe('main');
    expect(calls[0]).toContain('-c');
    expect(calls[0].some((arg) => arg.startsWith('http.curloptResolve=github.com:443:'))).toBe(true);
    expect(calls[0]).toContain('http.followRedirects=false');
    expect(calls[0]).toContain('credential.helper=');
  });
});
