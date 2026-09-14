import { type APIRequestContext } from '@playwright/test';
import { giteaAdminApi } from './gitea-api';

// Release 生命周期的 E2E 需要真实已发布的技能。CLI 的发布链路依赖本地 Git
// push 会话(克隆、commit、push HEAD:main),这里用 Gitea 的 Contents API 直接
// 写源文件——它是 push 的服务端等价物,产出同样的事实:技能仓库 main 分支上
// 含 SKILL.md 与 release.json 的 commit。随后走与 CLI 相同的发布端点
// POST /releases,由服务端读源树、按 release.json 断言身份并生成发布包。

/** Release Manifest v3（ADR-0032）：name 必填，是归属的唯一权威来源 */
export function releaseJson(name: string, version: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: 3,
      name,
      version,
      license: 'MIT',
      keywords: ['e2e'],
      compatibility: {},
      dependencies: {}
    },
    null,
    2
  )}\n`;
}

export function skillMd(shortName: string, description: string): string {
  return `---\nname: ${shortName}\ndescription: ${description}\n---\n\n# ${shortName}\n`;
}

interface GiteaFileResponse {
  commit?: { sha?: string };
  sha?: string;
}

/** 读取 Gitea 上已有文件的 blob SHA;文件不存在(404 或空仓库的空列表)返回 undefined */
async function getExistingSha(
  gitea: APIRequestContext,
  owner: string,
  repo: string,
  filePath: string
): Promise<string | undefined> {
  const response = await gitea.get(`/api/v1/repos/${owner}/${repo}/contents/${filePath}`);
  if (!response.ok()) return undefined;
  const body = (await response.json()) as GiteaFileResponse | GiteaFileResponse[];
  // 空仓库的 GET 不返回 404 而是空列表(200 []),同样视为不存在
  return Array.isArray(body) ? undefined : body.sha;
}

/** 创建或更新 Gitea 仓库文件,返回该次变更的 commit SHA(空仓库首次写入会建出默认分支) */
export async function upsertGiteaFile(
  gitea: APIRequestContext,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string
): Promise<string> {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const existingSha = await getExistingSha(gitea, owner, repo, encodedPath);
  const body: Record<string, unknown> = {
    content: Buffer.from(content, 'utf8').toString('base64'),
    message
  };
  if (existingSha) body.sha = existingSha;
  const response = await gitea[existingSha ? 'put' : 'post'](
    `/api/v1/repos/${owner}/${repo}/contents/${encodedPath}`,
    { data: body }
  );
  if (!response.ok()) {
    throw new Error(`Gitea 文件写入失败 (${filePath}): ${response.status()} ${await response.text()}`);
  }
  const result = (await response.json()) as GiteaFileResponse;
  const sha = result.commit?.sha;
  if (!sha) {
    throw new Error(`Gitea 文件写入响应缺少 commit.sha (${filePath})`);
  }
  return sha;
}

export interface PublishOptions {
  description?: string;
  notes?: string;
}

/**
 * 为已上传的技能源发布一个 Release(等价开发者的 `esl version <v>` + `esl publish`):
 * 先把 SKILL.md 与带权威 name 的 release.json 写入技能仓库,再以创建者
 * (初始 Maintainer,持管理权)的 token 调发布端点。
 * identity 形如 "@scope/skill-name";仓库路径为 "{scope}/{shortName}"。
 */
export async function publishSkillRelease(
  ownerApi: APIRequestContext,
  identity: string,
  version: string,
  options: PublishOptions = {}
): Promise<void> {
  const parsed = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(identity);
  if (!parsed) {
    throw new Error(`E2E 身份必须是 @scope/skill-name 形式: ${identity}`);
  }
  const [, scope, shortName] = parsed;
  const gitea = await giteaAdminApi();
  try {
    // SKILL.md 只在缺失时写入,避免每个版本多一个无意义 commit
    if (!(await getExistingSha(gitea, scope, shortName, 'SKILL.md'))) {
      await upsertGiteaFile(
        gitea,
        scope,
        shortName,
        'SKILL.md',
        skillMd(shortName, options.description ?? `E2E 发布技能 ${shortName}`),
        'chore: seed SKILL.md'
      );
    }
    const sourceCommit = await upsertGiteaFile(
      gitea,
      scope,
      shortName,
      'release.json',
      releaseJson(identity, version),
      `chore: release ${version}`
    );
    const response = await ownerApi.post(
      `/api/skills/${encodeURIComponent(scope)}/${encodeURIComponent(shortName)}/releases`,
      { data: { version, sourceCommit, notes: options.notes } }
    );
    if (!response.ok()) {
      throw new Error(`Release 发布失败 (${version}): ${response.status()} ${await response.text()}`);
    }
  } finally {
    await gitea.dispose();
  }
}
