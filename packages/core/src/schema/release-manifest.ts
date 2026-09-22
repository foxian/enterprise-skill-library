import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ValidationResult } from './validation-result.js';
import { SemVerSchema } from './skill-json.js';
import { validateSkillMd, type SkillMdMetadata } from '../skill/skill-md.js';

const SpdxLicenseSchema = z.string().regex(
  /^(?:MIT|Apache-2\.0|BSD-[234]-Clause|ISC|MPL-2\.0|GPL-[23]\.0|LGPL-[23]\.0|AGPL-[23]\.0)(?:\s+(?:AND|OR)\s+(?:MIT|Apache-2\.0|BSD-[234]-Clause|ISC|MPL-2\.0|GPL-[23]\.0|LGPL-[23]\.0|AGPL-[23]\.0))*$/,
  { message: 'license must be an SPDX expression or LicenseRef-* identifier' }
);

const LicenseSchema = z.union([
  SpdxLicenseSchema,
  z.string().regex(/^LicenseRef-[A-Za-z0-9.-]+$/, {
    message: 'license must be an SPDX expression or LicenseRef-* identifier'
  })
]);

// Release Manifest v4 的 name 是技能归属的唯一权威来源（ADR-0032）：
// `@scope/skill-name` 或无 scope 的 `skill-name`（解析为上传者个人命名空间）。
const SKILL_IDENTITY_PATTERN = '^(@[a-z0-9-]+/)?[a-z0-9-]{1,64}$';
export const SkillIdentitySchema = z.string().regex(new RegExp(SKILL_IDENTITY_PATTERN), {
  message: 'name must be "@scope/skill-name" or a bare "skill-name" (personal namespace)'
});

// 显示名长度上限（ADR-0048）：trim 后按字符数计。
export const DISPLAY_NAME_MAX_LENGTH = 128;

// 显示名（ADR-0048）：纯展示短标题，可为中文与空格，不参与身份/授权。空串与
// 全空白按「未设置」处理，trim 后长度上限 128。
const DisplayNameSchema = z
  .string({ message: 'displayName must be a string' })
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

export const ReleaseManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(3), z.literal(4)]),
    name: SkillIdentitySchema,
    version: SemVerSchema,
    license: LicenseSchema,
    displayName: DisplayNameSchema,
    keywords: z.array(z.string().min(1)),
    compatibility: z.object({
      tools: z.array(z.string().min(1)).optional(),
      languages: z.array(z.string().min(1)).optional()
    }),
    dependencies: z.record(z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/), z.string().min(1))
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.displayName === undefined) return;
    // 带 displayName 的清单必须是 v4（ADR-0048）：字段随 v4 引入，v3 保持
    // 旧契约不承载新字段，避免旧 CLI 遇未知键时既报错又无版本信号。
    if (data.schemaVersion === 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'displayName requires schemaVersion 4 (the field was added in Release Manifest v4)'
      });
    }
    // 长度上限按 trim 后计算（去空白）。
    if (data.displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: `displayName must be at most ${DISPLAY_NAME_MAX_LENGTH} characters after trimming`
      });
    }
  });

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export interface SkillIdentity {
  /** 持有命名空间的组织名；null 表示上传者个人命名空间（@用户名）。 */
  scope: string | null;
  shortName: string;
}

// Release Manifest v4 的 name 即 Skill Identity（ADR-0032）：`@scope/skill-name`
// 或裸 `skill-name`（消费端按上传者用户名补全为个人命名空间）。解析失败返回 null。
export function parseSkillIdentity(name: string): SkillIdentity | null {
  const match = name.match(/^@([a-z0-9-]+)\/([a-z0-9-]{1,64})$/);
  if (match) {
    return { scope: match[1], shortName: match[2] };
  }
  if (/^[a-z0-9-]{1,64}$/.test(name)) {
    return { scope: null, shortName: name };
  }
  return null;
}

// 显示名种子（ADR-0048）：init 生成 v4 清单时把机器短名转成标题
// （markdown-master → Markdown Master）。运行时解析对外显示名不做此转换，
// 只在此处生成可编辑的初始值。
export function titleCaseDisplayName(name: string): string {
  const shortName = parseSkillIdentity(name)?.shortName ?? name;
  return shortName
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function createMinimalReleaseManifest(
  name: string,
  license: string,
  displayName?: string
): ReleaseManifest {
  return {
    schemaVersion: 4,
    name,
    version: '0.1.0',
    license,
    ...(displayName ? { displayName } : {}),
    keywords: [],
    compatibility: {},
    dependencies: {}
  };
}

export function validateReleaseManifest(data: unknown): ValidationResult<ReleaseManifest> {
  const result = ReleaseManifestSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };

  const errors = result.error.issues.map((issue) => {
    const field = issue.path.join('.') || 'release.json';
    return `${field}: ${issue.message}`;
  });

  if (isPreVersionManifest(data)) {
    errors.push(
      'release.json: schemaVersion 1 is no longer supported; run `esl version <SemVer>` to record the version, then commit and push the source'
    );
  }

  if (isV2Manifest(data)) {
    errors.push(
      'release.json: schemaVersion 2 is no longer supported; add the required "name" field ("@scope/skill-name" or a bare "skill-name") and set schemaVersion to 3 or 4'
    );
  }

  return { success: false, errors };
}

function isPreVersionManifest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

function isV2Manifest(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { schemaVersion?: unknown }).schemaVersion === 2
  );
}

export interface SkillSourceDirectory {
  directory: string;
  skillMd: SkillMdMetadata;
  releaseManifest: ReleaseManifest;
}

export async function validateSkillSourceDirectory(
  directory: string
): Promise<ValidationResult<SkillSourceDirectory>> {
  const resolved = path.resolve(directory);
  const skillMdPath = path.join(resolved, 'SKILL.md');
  const releaseManifestPath = path.join(resolved, 'release.json');
  const errors: string[] = [];

  let skillMd: SkillMdMetadata | undefined;
  let releaseManifest: ReleaseManifest | undefined;

  try {
    const validation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
    if (validation.success) skillMd = validation.data;
    else errors.push(...validation.errors);
  } catch {
    errors.push('SKILL.md: file is required');
  }

  try {
    const parsed = JSON.parse(await fs.readFile(releaseManifestPath, 'utf8')) as unknown;
    const validation = validateReleaseManifest(parsed);
    if (validation.success) releaseManifest = validation.data;
    else errors.push(...validation.errors);
  } catch {
    errors.push('release.json: file is required and must contain valid JSON');
  }

  if (errors.length > 0 || !skillMd || !releaseManifest) {
    return { success: false, errors };
  }
  return { success: true, data: { directory: resolved, skillMd, releaseManifest } };
}
