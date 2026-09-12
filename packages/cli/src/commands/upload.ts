import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildGiteaUsername, fileExists, giteaUserEmail, isBuiltinIdentity, loadConfig, validateSkillSourceDirectory } from '@esl/core';
import {
  apiUrl,
  fetchWithTimeout,
  gitAuthHeaderConfig,
  parseHttpOrigin,
  requireFreshToken,
  resolveNetworkConfig,
  type NetworkCommandOptions
} from './network-options.js';
import { ensureReleaseManifest } from './release-manifest.js';
import { executeInfo } from './info.js';
import { isInteractive, readText } from '../prompt.js';
import { notify } from '../output.js';

const defaultExecFileAsync = promisify(execFile);

const DEFAULT_COMMIT_MESSAGE = 'chore: commit skill source for esl upload';

export interface UploadOptions extends NetworkCommandOptions {
  directory?: string;
  license?: string;
  message?: string;
  noInput?: boolean;
  execFileAsync?: typeof defaultExecFileAsync;
}

export interface UploadedSkill {
  name: string;
  skillId: string;
  cloneUrl: string;
  status?: string;
  alreadyUpToDate?: boolean;
}

export async function executeUpload(options: UploadOptions = {}): Promise<UploadedSkill> {
  const directory = options.directory ?? process.cwd();
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const skillJsonPath = path.join(directory, 'skill.json');
  if (await fileExists(skillJsonPath)) {
    const raw = await fs.readFile(skillJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string };
    if (parsed.name && isBuiltinIdentity(parsed.name)) {
      throw new Error('Built-in skills cannot be uploaded; they are bundled with the ESL CLI');
    }
  }
  if (!(await fileExists(`${directory}/release.json`))) {
    await ensureReleaseManifest(options, directory);
  }
  const sourceValidation = await validateSkillSourceDirectory(directory);
  if (!sourceValidation.success) {
    throw new Error(`Invalid skill source: ${sourceValidation.errors.join(', ')}`);
  }
  const message = await resolveUploadMessage(options);
  await prepareSourceGit(execFileAsync, directory, message, await resolveFallbackGitIdentity(options));
  return uploadSource(
    options,
    directory,
    sourceValidation.data.skillMd.name,
    sourceValidation.data.skillMd.description
  );
}

const DEFAULT_GITIGNORE = [
  '# ESL skill upload ignores generated and local-only artifacts',
  '.pytest_cache/',
  '__pycache__/',
  '*.pyc',
  'node_modules/',
  '.DS_Store',
  'dist/',
  'build/',
  '.venv/',
  ''
].join('\n');

async function resolveUploadMessage(options: UploadOptions): Promise<string> {
  if (options.message) {
    return options.message;
  }
  if (options.noInput || !isInteractive()) {
    return '';
  }
  return (await readText('Describe this upload (optional, press Enter to skip): ')).trim();
}

export interface GitIdentity {
  name: string;
  email: string;
}

// 未显式配置 git 身份时的仓库级兜底作者:优先用当前登录的 Skill User
// (组织作用域账号 + Git Backend 的 email 约定),使 Git Backend 能把提交
// 匹配到登录账号;未登录或本地存储缺失时退回通用占位身份。
async function resolveFallbackGitIdentity(options: UploadOptions): Promise<GitIdentity> {
  try {
    const config = await loadConfig({ homeDir: options.homeDir });
    if (config.org && config.username) {
      const giteaUsername = buildGiteaUsername(config.org, config.username);
      if (giteaUsername) {
        return { name: giteaUsername, email: giteaUserEmail(giteaUsername) };
      }
    }
  } catch {
    // Fall through to the generic placeholder identity.
  }
  return { name: 'esl upload', email: 'esl@local' };
}

async function prepareSourceGit(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  message: string,
  fallbackIdentity: GitIdentity
): Promise<void> {
  // Initialize the repository when the skill directory is not already one.
  try {
    const inside = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory });
    if (inside.stdout.trim() !== 'true') {
      await execFileAsync('git', ['init'], { cwd: directory });
    }
  } catch {
    await execFileAsync('git', ['init'], { cwd: directory });
  }

  // Write a base .gitignore when none exists so generated junk stays out of the source.
  const gitignorePath = path.join(directory, '.gitignore');
  if (!(await fileExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, DEFAULT_GITIGNORE);
  }

  // Use a repository-local identity fallback so the auto-commit never blocks
  // on a missing git user.name / user.email (repo-local only, never global).
  // 兜底作者优先取当前登录身份,使提交在 Git Backend 里可关联到该账号。
  if (!(await readGitConfig(execFileAsync, directory, 'user.name'))) {
    await execFileAsync('git', ['config', 'user.name', fallbackIdentity.name], { cwd: directory });
  }
  if (!(await readGitConfig(execFileAsync, directory, 'user.email'))) {
    await execFileAsync('git', ['config', 'user.email', fallbackIdentity.email], { cwd: directory });
  }

  // If a previous upload hit a merge conflict and left a rebase in progress,
  // the user has resolved the marked files: continue that rebase instead of
  // creating a new commit on top of the conflicted state.
  if (await isRebaseInProgress(directory)) {
    await execFileAsync('git', ['add', '-A'], { cwd: directory });
    try {
      await execFileAsync('git', ['rebase', '--continue'], { cwd: directory });
    } catch (error) {
      throw new Error(
        `Still have unresolved source conflicts; resolve the marked files then re-run "esl upload": ${(error as Error).message}`
      );
    }
  } else {
    // Commit uncommitted changes so HEAD matches the source being uploaded,
    // using the user-provided upload message as the commit message when given.
    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: directory });
    if (status.stdout.trim()) {
      await execFileAsync('git', ['add', '-A'], { cwd: directory });
      await execFileAsync('git', ['commit', '-m', message || DEFAULT_COMMIT_MESSAGE], { cwd: directory });
    }
  }
}

async function isRebaseInProgress(directory: string): Promise<boolean> {
  return (
    (await fileExists(path.join(directory, '.git', 'rebase-merge'))) ||
    (await fileExists(path.join(directory, '.git', 'rebase-apply')))
  );
}

async function readGitConfig(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  key: string
): Promise<string> {
  try {
    const res = await execFileAsync('git', ['config', key], { cwd: directory });
    return res.stdout.trim();
  } catch {
    return '';
  }
}

async function uploadSource(
  options: UploadOptions,
  directory: string,
  skillName: string,
  description: string
): Promise<UploadedSkill> {
  const authToken = await requireFreshToken(options);
  const server = options.server ?? (await resolveNetworkConfig(options)).server;
  const execFileAsync = options.execFileAsync ?? defaultExecFileAsync;
  const authHeader = gitAuthHeaderConfig(authToken);

  let uploaded: UploadedSkill;
  let remoteUrl: string;
  if (await hasEslRemote(execFileAsync, directory)) {
    // Already server-hosted: skip the registration call and sync straight
    // against the existing source.
    remoteUrl = (await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory })).stdout.trim();
    // ADR-0023：Source Remote 重指——origin 漂移（Server Origin 迁移）时先按
    // 身份向当前 server 验证，再采用服务器 cloneUrl 修复 remote；验证不过则
    // 报可行动错误，绝不重新注册或接管。
    remoteUrl = await rehomeEslRemoteIfNeeded(options, execFileAsync, directory, remoteUrl, server);
    const remoteShortName = repoPathFromGitUrl(remoteUrl).split('/').pop() ?? '';
    if (remoteShortName && remoteShortName !== skillName) {
      throw new Error(
        `Local skill name "${skillName}" does not match the source repository "${remoteShortName}"; ` +
          'renames must go through "esl rename", not by editing SKILL.md'
      );
    }
    uploaded = { name: skillNameFromRemote(remoteUrl), skillId: '', cloneUrl: remoteUrl };
    // 技能描述(CONTEXT:Skill Description)随每次 Source Update 登记到服务器:
    // 它是纯元数据更新,尽力而为——失败不阻断源码同步,仅在输出中提示。
    try {
      const [scope, shortName] = uploaded.name.split('/');
      const descriptionImpl = options.customFetch ?? fetch;
      const descriptionResponse = await fetchWithTimeout(
        descriptionImpl,
        apiUrl(
          server,
          `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(shortName)}/description`
        ),
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ description })
        }
      );
      if (!descriptionResponse.ok) {
        console.warn(
          `Note: the server rejected the description update (${descriptionResponse.status}); the source sync is unaffected.`
        );
      }
    } catch {
      console.warn('Note: the description update could not reach the server; the source sync is unaffected.');
    }
  } else {
    const fetchImpl = options.customFetch ?? fetch;
    const response = await fetchWithTimeout(fetchImpl, apiUrl(server, '/api/skills/upload'), {
      method: 'POST',
      headers: {
        Authorization: `token ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: skillName, description })
    });
    if (!response.ok) {
      throw new Error(`Failed to upload skill source: ${await response.text()}`);
    }
    uploaded = (await response.json()) as UploadedSkill;
    if (!uploaded.cloneUrl || !uploaded.skillId || !uploaded.name) {
      throw new Error('Failed to upload skill source: API response is incomplete');
    }
    remoteUrl = uploaded.cloneUrl;
    await ensureEslRemote(execFileAsync, directory, uploaded.cloneUrl);
  }

  try {
    if ((await syncSource(options, execFileAsync, directory, authHeader, remoteUrl)) === 'up-to-date') {
      return { ...uploaded, alreadyUpToDate: true };
    }
  } catch (error) {
    // syncSource 已按 ADR-0021 包裹指导,透传即可,避免指导段落重复。
    if (error instanceof HostedSourceAccessError) throw error;
    throw hostedSourceAccessError((error as Error).message);
  }
  try {
    await execFileAsync('git', ['-c', authHeader, 'push', 'esl', 'HEAD:main'], { cwd: directory });
  } catch (error) {
    // ADR-0021：不可访问的已托管源绝不被接管。错误给出两条恢复出路——
    // 切回维护账号重跑 upload，或显式两步手动重建——绝不触碰 remote。
    throw hostedSourceAccessError((error as Error).message, { includePushHint: true });
  }
  return uploaded;
}

// 带身份标记的「已托管源不可访问」错误:调用方据此识别错误已被包裹,避免对已
// 带指导的错误再次包裹导致指导段落重复。
class HostedSourceAccessError extends Error {}

function hostedSourceAccessError(detail: string, options: { includePushHint?: boolean } = {}): Error {
  const guidance =
    'Failed to sync the skill source with the server: the current login cannot access the server source at the esl remote. ' +
    'The source may be maintained by another account or organization, or it may no longer exist. ' +
    'Log in with the maintaining account and re-run "esl upload"; ' +
    'or, if the server source is confirmed deleted, run "git remote remove esl" and re-run "esl upload" to register a fresh source.';
  const pushHint = options.includePushHint
    ? ' To finish an interrupted push on an already-registered source, run "git push esl HEAD:main".'
    : '';
  return new HostedSourceAccessError(`${guidance}${pushHint} (${detail})`);
}

// ADR-0027：fetch 失败时的只读诊断。向 Registry API 查询 remote 揭示的
// Skill Identity；只有身份在当前登录下可见时才细分文案——
//  - 服务器 cloneUrl 与 remote 仓库路径不一致 → remote 指向陈旧路径；
//  - 路径一致 → 源存在、当前登录具备 Registry 读权限但缺 Git 源访问权限，
//    指引切回维护账号。
// 探测失败（404/403/网络）时退回 ADR-0021 的统一文案，不猜测「已删除」。
async function diagnoseHostedSourceAccess(options: UploadOptions, remoteUrl: string, detail: string): Promise<Error> {
  if (!remoteUrl.startsWith('http')) return hostedSourceAccessError(detail);
  const identity = skillNameFromRemote(remoteUrl);
  let info;
  try {
    info = await executeInfo(identity, options);
  } catch {
    return hostedSourceAccessError(detail);
  }
  const serverClonePath = info.cloneUrl ? repoPathFromGitUrl(info.cloneUrl) : '';
  const remotePath = repoPathFromGitUrl(remoteUrl);
  if (!serverClonePath || serverClonePath === remotePath) {
    return new HostedSourceAccessError(
      `Failed to sync the skill source with the server: the skill identity ${identity} exists on the server and is visible ` +
        'with the current login, but the current login cannot access its Git source. ' +
        'The credential may be stale or the login may lack repository access (the source may be maintained by another ' +
        'account, or its access was revoked). Log in with the maintaining account and re-run "esl upload". ' +
        `(${detail})`
    );
  }
  return new HostedSourceAccessError(
    `The esl remote points at repository path "${remotePath}" but the server's current clone URL for ${identity} is "${serverClonePath}". ` +
      'The remote path is stale (for example after a rename). Verify the source location ("esl source"), then run ' +
      '"git remote remove esl" and re-run "esl upload" to re-register or re-sync against the current repository. ' +
      `(${detail})`
  );
}

function skillNameFromRemote(remoteUrl: string): string {
  const match = remoteUrl.match(/\/git\/(.+?)(?:\.git)?\/?$/);
  return match ? `@${match[1]}` : 'source';
}

// 从服务器 cloneUrl / Source Remote URL 中取出 /git/ 之后的仓库路径。
function repoPathFromGitUrl(url: string): string {
  return url.match(/\/git\/(.+?)(?:\.git)?\/?$/)?.[1] ?? '';
}

// ADR-0023：Source Remote 重指。检测到 Source Remote origin 与当前配置 server
// 的 origin 漂移（Server Origin 迁移）时，以旧 remote 路径解析出的 Skill
// Identity 向当前 server 验证（含 Skill Rename 重定向），验证通过则采用服务器
// 返回的 cloneUrl（ADR-0004：客户端不自行推导后端路径）静默重指；验证不过则
// 报可行动错误，不触碰所有权（不创建 Skill ID、不删除 remote）。
async function rehomeEslRemoteIfNeeded(
  options: UploadOptions,
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  remoteUrl: string,
  server: string
): Promise<string> {
  const oldOrigin = parseHttpOrigin(remoteUrl);
  const newOrigin = parseHttpOrigin(server);
  if (!oldOrigin || !newOrigin || oldOrigin === newOrigin) {
    return remoteUrl;
  }
  const identity = skillNameFromRemote(remoteUrl);
  if (!identity.startsWith('@')) {
    throw sourceRemoteUnverifiedError(oldOrigin, newOrigin, null);
  }
  let cloneUrl: string | undefined;
  try {
    const info = await executeInfo(identity, options);
    cloneUrl = info.cloneUrl;
  } catch {
    cloneUrl = undefined;
  }
  if (!cloneUrl) {
    throw sourceRemoteUnverifiedError(oldOrigin, newOrigin, identity);
  }
  if (parseHttpOrigin(cloneUrl) === oldOrigin) {
    // 服务器返回的 cloneUrl 与现 remote 同源：remote 已指向权威地址，无需重指。
    return remoteUrl;
  }
  await execFileAsync('git', ['remote', 'set-url', 'esl', cloneUrl], { cwd: directory });
  notify(`Server origin migration detected: re-homed the esl remote from ${oldOrigin} to ${newOrigin}.`);
  return cloneUrl;
}

// ADR-0023：地址迁移验证失败的可行动错误——与 ADR-0021 的「账号/权限」语义区分。
function sourceRemoteUnverifiedError(oldOrigin: string, newOrigin: string, identity: string | null): Error {
  const identityClause = identity
    ? `the skill identity ${identity} could not be verified on ${newOrigin}`
    : 'the skill identity could not be determined from the remote URL';
  return new Error(
    `The esl remote points at ${oldOrigin} but the configured ESL server is ${newOrigin}; ` +
      'this looks like a server origin migration, but ' +
      `${identityClause} (it may not exist there, or the current login cannot read it - ` +
      'the source may be maintained by another account or organization). ' +
      'Log in with the maintaining account and re-run "esl upload"; ' +
      'or, if the source is confirmed absent from this server, run "git remote remove esl" and re-run "esl upload" to register a fresh source.'
  );
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

async function syncSource(
  options: UploadOptions,
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  authHeader: string,
  remoteUrl: string
): Promise<'up-to-date' | 'needs-push'> {
  // Refresh the server-side ref so we can compare and rebase onto it.
  // ADR-0021：已托管源上任何 fetch 失败一律按「凭据不足或源不可达」处理，
  // 不视为可接管的孤儿。
  try {
    await execFileAsync('git', ['-c', authHeader, 'fetch', 'esl'], { cwd: directory });
  } catch (error) {
    // ADR-0027：Git Backend 对「无权限」与「不存在」返回相同 404；报错前用
    // Registry API 只读探测一次身份，探测成功才细分文案，失败退回统一文案。
    // 行为不变：不自动接管、不重指。
    throw await diagnoseHostedSourceAccess(options, remoteUrl, (error as Error).message);
  }
  let remoteHead: string;
  try {
    remoteHead = (await execFileAsync('git', ['rev-parse', '--verify', 'esl/main'], { cwd: directory })).stdout.trim();
  } catch {
    return 'needs-push'; // the server source has no commits yet (first push)
  }
  const localHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  if (localHead === remoteHead) {
    return 'up-to-date';
  }
  const behind = parseInt(
    (await execFileAsync('git', ['rev-list', '--count', 'HEAD..esl/main'], { cwd: directory })).stdout.trim() || '0',
    10
  );
  if (behind > 0) {
    // Rebase local commits onto the server source. On a content conflict the
    // rebase is left in progress so the user can resolve the marked files and
    // re-run upload to finish the merge and push.
    try {
      await execFileAsync('git', ['rebase', 'esl/main'], { cwd: directory });
    } catch {
      throw new Error(
        `Source update conflict: the server source advanced by ${behind} commit(s) and your local edits overlap. ` +
          'Conflicted files are marked in your editor; resolve them, then re-run "esl upload" to finish the merge and push.'
      );
    }
  }
  return 'needs-push';
}

async function ensureEslRemote(
  execFileAsync: typeof defaultExecFileAsync,
  directory: string,
  cloneUrl: string
): Promise<void> {
  try {
    await execFileAsync('git', ['remote', 'add', 'esl', cloneUrl], { cwd: directory });
    return;
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (!message.includes('remote esl already exists') && !message.includes('remote `esl` already exists')) {
      throw error;
    }
  }
  // An interrupted Source Upload may be resumed when the existing Source Remote
  // already points at the same server source; a different URL must be resolved first.
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'esl'], { cwd: directory });
  const currentUrl = stdout.trim();
  if (currentUrl !== cloneUrl) {
    throw new Error(
      `Skill source already has an esl remote pointing at ${currentUrl}; remove it with "git remote remove esl" or point it at ${cloneUrl}`
    );
  }
}