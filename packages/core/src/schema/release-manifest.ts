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

// Release Manifest v3 的 name 是技能归属的唯一权威来源（ADR-0032）：
// `@scope/skill-name` 或无 scope 的 `skill-name`（解析为上传者个人命名空间）。
const SKILL_IDENTITY_PATTERN = '^(@[a-z0-9-]+/)?[a-z0-9-]{1,64}$';
export const SkillIdentitySchema = z.string().regex(new RegExp(SKILL_IDENTITY_PATTERN), {
  message: 'name must be "@scope/skill-name" or a bare "skill-name" (personal namespace)'
});

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(3),
  name: SkillIdentitySchema,
  version: SemVerSchema,
  license: LicenseSchema,
  keywords: z.array(z.string().min(1)),
  compatibility: z.object({
    tools: z.array(z.string().min(1)).optional(),
    languages: z.array(z.string().min(1)).optional()
  }),
  dependencies: z.record(z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/), z.string().min(1))
}).strict();

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export interface SkillIdentity {
  /** 持有命名空间的组织名；null 表示上传者个人命名空间（@用户名）。 */
  scope: string | null;
  shortName: string;
}

// Release Manifest v3 的 name 即 Skill Identity（ADR-0032）：`@scope/skill-name`
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

export function createMinimalReleaseManifest(name: string, license: string): ReleaseManifest {
  return {
    schemaVersion: 3,
    name,
    version: '0.1.0',
    license,
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
      'release.json: schemaVersion 2 is no longer supported; add the required "name" field ("@scope/skill-name" or a bare "skill-name") and set schemaVersion to 3'
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
