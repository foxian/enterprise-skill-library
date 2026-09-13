import { type APIRequestContext } from '@playwright/test';
import { resolveTestEnv } from './env';
import { giteaAdminApi } from './gitea-api';

// 单版本删除等 Release 生命周期的 E2E 需要真实已发布的技能。CLI 的发布链路
// 依赖本地 Git push 会话(克隆、commit、push HEAD:main),这里用 Gitea 的
// Contents API 直接写源文件——它是 push 的服务端等价物,产出同样的事实:
// 技能仓库 main 分支上含 SKILL.md 与 release.json 的 commit。随后走与 CLI
// 相同的发布端点 POST /releases,由服务端读源树、生成发布包与 Release Tag。

function releaseJson(version: string): string {
  // ADR-0030:Release Manifest 要求 schemaVersion 2 且携带 version(.strict() 校验)
  return `${JSON.stringify(
    {
      schemaVersion: 2,
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

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
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
async function upsertGiteaFile(
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

/**
 * 为已上传的技能源发布一个 Release(等价开发者的 `esl version <v>` + `esl publish`):
 * 先确保 SKILL.md 存在,再以 release.json 的新版本内容产生 commit,最后用创建者
 * (初始 Maintainer,持管理权)的 token 调发布端点。
 */
export async function publishSkillRelease(
  ownerApi: APIRequestContext,
  skillName: string,
  version: string,
  options: { description?: string; notes?: string } = {}
): Promise<void> {
  const env = resolveTestEnv();
  const gitea = await giteaAdminApi();
  try {
    const owner = env.org;
    // SKILL.md 只在缺失时写入,避免每个版本多一个无意义 commit
    if (!(await getExistingSha(gitea, owner, skillName, 'SKILL.md'))) {
      await upsertGiteaFile(
        gitea,
        owner,
        skillName,
        'SKILL.md',
        skillMd(skillName, options.description ?? `E2E 发布技能 ${skillName}`),
        'chore: seed SKILL.md'
      );
    }
    const sourceCommit = await upsertGiteaFile(
      gitea,
      owner,
      skillName,
      'release.json',
      releaseJson(version),
      `chore: release ${version}`
    );
    const response = await ownerApi.post(
      `/api/skills/${encodeURIComponent(env.org)}/${encodeURIComponent(skillName)}/releases`,
      { data: { version, sourceCommit, notes: options.notes } }
    );
    if (!response.ok()) {
      throw new Error(`Release 发布失败 (${version}): ${response.status()} ${await response.text()}`);
    }
  } finally {
    await gitea.dispose();
  }
}
