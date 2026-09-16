import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createMinimalReleaseManifest,
  loadConfig,
  validateSkillMd,
  validateSkillSourceDirectory,
  type LocalStoreOptions,
  type OrganizationMembership
} from '@esl/core';
import { notify } from '../output.js';
import { isInteractive, readText } from '../prompt.js';
import { apiUrl, fetchWithTimeout, resolveOptionalFreshToken } from './network-options.js';

const execFileAsync = promisify(execFile);

export interface InitOptions extends LocalStoreOptions {
  /** Skill directory to fill in (created when missing). Defaults to the current directory. */
  directory?: string;
  /** Skill short name for a generated SKILL.md. Defaults to the directory basename. */
  name?: string;
  /** Namespace for release.json: "personal" (default) or an organization name. */
  namespace?: string;
  runGitInit?: boolean;
  license?: string;
  keywords?: string[];
  description?: string;
  /** Skips every prompt and writes the missing artifacts as-is. */
  noInput?: boolean;
  /** Injected by tests in place of the interactive prompt. */
  promptText?: (question: string, fallback: string) => Promise<string>;
  /** Injected by tests in place of the real fetch for the namespace menu. */
  customFetch?: typeof fetch;
}

/**
 * YAML frontmatter is line-oriented, so a description containing a colon, a
 * quote, or a leading special character has to be quoted to keep the generated
 * SKILL.md parseable.
 */
function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 .,;!?'()\-/]*$/.test(value) ? value : JSON.stringify(value);
}

function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(name);
}

function normalizeNamespace(value: string): string | null {
  const namespace = value.trim().replace(/^@/, '');
  if (!namespace || namespace === 'personal') return null;
  if (!isValidSkillName(namespace)) {
    throw new Error(
      'Namespace must be "personal" or use lowercase letters, digits, and hyphens (1-64 characters)'
    );
  }
  return namespace;
}

// namespace 菜单的数据来源：优先实时查询服务端组织列表，请求失败或未登录时
// 回退登录时缓存的成员关系；两者都没有则返回 null，由调用方退回手输提示。
// 整个解析尽力而为，绝不阻断离线的 init。
async function resolveNamespaceChoices(options: InitOptions): Promise<string[] | null> {
  const config = await loadConfig({ homeDir: options.homeDir }).catch(() => null);
  let memberships: (OrganizationMembership & { status?: string })[] | null = null;

  const token = await resolveOptionalFreshToken(options);
  if (token && config?.server) {
    try {
      const fetchImpl = options.customFetch ?? fetch;
      const response = await fetchWithTimeout(
        fetchImpl,
        apiUrl(config.server, '/api/orgs/mine'),
        { headers: { Authorization: `token ${token}` } },
        // 菜单是锦上添花：网络不健康时快速回退，不让 init 卡在超时上。
        3_000
      );
      if (response.ok) {
        const data = (await response.json()) as {
          organizations?: (OrganizationMembership & { status?: string })[];
        };
        memberships = Array.isArray(data.organizations)
          ? data.organizations.filter((membership) => !membership.status || membership.status === 'active')
          : [];
      }
    } catch {
      // Fall back to the login-time cache below.
    }
  }
  if (!memberships && config?.organizations) {
    memberships = config.organizations;
  }
  return memberships ? memberships.map((membership) => membership.org) : null;
}

export async function executeInit(options: InitOptions = {}): Promise<string> {
  const runGitInit = options.runGitInit ?? true;
  const targetDir = path.resolve(options.directory ?? process.cwd());

  await fs.mkdir(targetDir, { recursive: true });

  // 已有 SKILL.md 是身份权威：存在则以它为准，绝不改写；非法时记录警告，
  // 严格校验留给 validate/upload，init 只管补缺。
  const skillMdPath = path.join(targetDir, 'SKILL.md');
  const existingSkillMd = await fs.readFile(skillMdPath, 'utf8').then(
    (content) => content,
    () => undefined
  );

  let skillName: string | undefined;
  if (existingSkillMd !== undefined) {
    const parsed = validateSkillMd(existingSkillMd);
    if (parsed.success) {
      skillName = parsed.data.name;
      if (options.name !== undefined && options.name !== skillName) {
        notify(`SKILL.md declares the name ${skillName}; ignoring --name ${options.name}.`);
      }
    } else {
      notify(`SKILL.md exists but is not a valid ESL skill source: ${parsed.errors.join(', ')}`);
      notify('Leaving SKILL.md untouched; only filling in the missing release manifest.');
    }
  }

  const generateSkillMd = existingSkillMd === undefined;
  if (generateSkillMd) {
    skillName = options.name ?? path.basename(targetDir);
    if (!isValidSkillName(skillName)) {
      throw new Error(
        `Skill name must use lowercase letters, digits, and hyphens (1-64 characters); pass one via --name: got ${skillName}`
      );
    }
  }

  const releaseJsonPath = path.join(targetDir, 'release.json');
  const generateReleaseJson = !(await fs
    .access(releaseJsonPath)
    .then(
      () => true,
      () => false
    ));

  const defaultDescription = `Use when a user needs the ${skillName} workflow or domain guidance.`;
  let description = options.description ?? defaultDescription;
  let license = options.license ?? 'MIT';
  let keywords = options.keywords ?? [];
  let namespace: string | null | undefined;

  // Interactive terminals get asked; scripts and --no-input keep the template.
  const ask = options.promptText ?? (isInteractive() ? readText : undefined);
  if (ask && !options.noInput) {
    if (generateSkillMd && options.description === undefined) {
      const answer = (await ask(`Description [${defaultDescription}]: `, defaultDescription)).trim();
      description = answer || defaultDescription;
    }
    if (generateReleaseJson && options.license === undefined) {
      const answer = (await ask('License (SPDX) [MIT]: ', 'MIT')).trim();
      license = answer || 'MIT';
    }
    if (generateReleaseJson && options.keywords === undefined) {
      const answer = (await ask('Keywords (comma separated) [none]: ', '')).trim();
      keywords = answer
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0);
    }
    if (generateReleaseJson && options.namespace === undefined) {
      const choices = await resolveNamespaceChoices(options);
      if (choices) {
        // 编号选择：1 固定为 personal，其余为所在组织；也接受直接输入组织名。
        const menu = [
          'Namespace:',
          '  1. personal (default)',
          ...choices.map((org, index) => `  ${index + 2}. @${org}`)
        ].join('\n');
        notify(menu);
        while (true) {
          const answer = (await ask('Select namespace [1]: ', '1')).trim().replace(/^@/, '');
          if (!answer || answer === '1' || answer === 'personal') break;
          if (/^\d+$/.test(answer)) {
            const org = choices[Number(answer) - 2];
            if (org) {
              namespace = org;
              break;
            }
          } else if (choices.includes(answer)) {
            namespace = answer;
            break;
          }
          notify(`Invalid namespace; enter 1-${choices.length + 1}, "personal", or an organization name.`);
        }
      } else {
        const answer = (await ask('Namespace (personal or organization) [personal]: ', 'personal')).trim();
        namespace = normalizeNamespace(answer || 'personal');
      }
    }
  }

  if (generateReleaseJson) {
    // v3 的 name 是归属声明（ADR-0032）：默认裸名，由服务端按上传者补全
    // 个人命名空间；组织归属必须显式选择，避免静默推断不可逆身份。
    const defaultName = skillName ?? path.basename(targetDir);
    namespace ??= options.namespace === undefined ? null : normalizeNamespace(options.namespace);
    const scopedName = namespace ? `@${namespace}/${defaultName}` : defaultName;
    const releaseJson = { ...createMinimalReleaseManifest(scopedName, license), keywords };
    await fs.writeFile(releaseJsonPath, `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
  }

  if (generateSkillMd) {
    await fs.writeFile(
      skillMdPath,
      `---
name: ${skillName}
description: ${yamlScalar(description)}
---

# ${skillName}

Write concise agent instructions here. Move long reference material into references/, reusable scripts into scripts/, and output templates or assets into assets/.
`,
      'utf8'
    );
    const validation = await validateSkillSourceDirectory(targetDir);
    if (!validation.success) {
      throw new Error(`Generated invalid skill source: ${validation.errors.join(', ')}`);
    }
  }

  if (runGitInit) {
    // 目标已在 git 仓库内（含父级仓库）时静默跳过，避免覆盖既有的仓库状态。
    let alreadyRepo = false;
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: targetDir });
      alreadyRepo = true;
    } catch {
      alreadyRepo = false;
    }
    if (!alreadyRepo) {
      await execFileAsync('git', ['init'], { cwd: targetDir });
    }
  }

  return targetDir;
}
