import type { ByteFileMap } from '../published-package-archive.js';
import { validateSkillMd } from '../skill-md.js';

// 引入外部技能时的许可证探测与元数据映射（ADR-0074）：只做“检测 + 展示来源”，
// 是否具备再分发权利由管理者显式确认；检测不到时绝不猜测默认许可证。

export const LICENSE_FILE_CANDIDATES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'COPYING',
  'COPYING.md'
];

export interface DetectedLicense {
  license?: string;
  provenance?: {
    path: string;
    source: 'file' | 'release.json';
  };
}

interface LicenseRule {
  license: string;
  patterns: RegExp[];
}

const LICENSE_RULES: LicenseRule[] = [
  {
    license: 'Apache-2.0',
    patterns: [/apache license,?\s*version 2\.0/i, /licensed under the apache license, version 2\.0/i]
  },
  {
    license: 'MIT',
    patterns: [/mit license/i, /permission is hereby granted, free of charge/i]
  },
  {
    license: 'BSD-3-Clause',
    patterns: [/redistribution and use in source and binary forms[\s\S]*neither the name/i]
  },
  {
    license: 'BSD-2-Clause',
    patterns: [/redistribution and use in source and binary forms[\s\S]*this software is provided/i]
  },
  {
    license: 'ISC',
    patterns: [/permission to use, copy, modify,? and(?:\/or)? distribute this software/i]
  },
  {
    license: 'MPL-2.0',
    patterns: [/mozilla public license,?\s*version 2\.0/i]
  },
  {
    license: 'GPL-3.0',
    patterns: [/gnu general public license,?\s*version 3/i]
  },
  {
    license: 'GPL-2.0',
    patterns: [/gnu general public license,?\s*version 2/i]
  }
];

function matchLicenseText(text: string): string | undefined {
  for (const rule of LICENSE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.license;
  }
  return undefined;
}

export interface LicenseCandidateText {
  path: string;
  text: string;
}

function candidateNameIndex(filePath: string): number {
  const name = filePath.split('/').pop()?.toLowerCase() ?? '';
  return LICENSE_FILE_CANDIDATES.findIndex((candidate) => candidate.toLowerCase() === name);
}

function candidateDepth(filePath: string): number {
  return filePath.split('/').filter((part) => part.length > 0).length - 1;
}

// 候选文件按调用方给出的优先级依次识别；任何命中都记录来源路径。
// 预览/编辑来源时调用方已按“技能目录优先、祖先目录由近及远”排序。
export function detectLicenseFromCandidates(
  candidates: LicenseCandidateText[]
): DetectedLicense {
  for (const candidate of candidates) {
    const license = matchLicenseText(candidate.text);
    if (license) return { license, provenance: { path: candidate.path, source: 'file' } };
  }
  return {};
}

export function detectLicenseFromFiles(files: ByteFileMap): DetectedLicense {
  const candidates: LicenseCandidateText[] = Object.keys(files)
    .filter((filePath) => candidateNameIndex(filePath) >= 0)
    .sort((left, right) => {
      // 越靠近技能根目录的候选越可信，避免误取嵌套依赖里的第三方许可证。
      const depthOrder = candidateDepth(left) - candidateDepth(right);
      if (depthOrder !== 0) return depthOrder;
      const nameOrder = candidateNameIndex(left) - candidateNameIndex(right);
      if (nameOrder !== 0) return nameOrder;
      return left.localeCompare(right);
    })
    .map((filePath) => ({ path: filePath, text: files[filePath].toString('utf8') }));
  const detected = detectLicenseFromCandidates(candidates);
  if (detected.license) return detected;
  const releaseJson = files['release.json'];
  if (releaseJson) {
    try {
      const parsed = JSON.parse(releaseJson.toString('utf8')) as { license?: unknown };
      if (typeof parsed.license === 'string' && parsed.license.trim().length > 0) {
        return {
          license: parsed.license.trim(),
          provenance: { path: 'release.json', source: 'release.json' }
        };
      }
    } catch {
      // release.json 非法时忽略其许可证线索，由正文检测兜底。
    }
  }
  return {};
}

export interface MergedUpstreamMetadata {
  schemaVersion: 4;
  name: string;
  version: string;
  license: string;
  displayName?: string;
  keywords: string[];
  compatibility: Record<string, unknown>;
  dependencies: Record<string, string>;
  description?: string;
}

interface MergeInput {
  platformIdentity: string;
  platformVersion: string;
  detectedLicense: string;
  upstreamFiles: ByteFileMap;
}

// 平台始终权威掌控身份与版本；上游 release.json 仅可提供 license、描述、关键词等
// 非身份元数据（ADR-0074 字段映射）。
export function mergeUpstreamMetadata(input: MergeInput): MergedUpstreamMetadata {
  const merged: MergedUpstreamMetadata = {
    schemaVersion: 4,
    name: input.platformIdentity,
    version: input.platformVersion,
    license: input.detectedLicense,
    keywords: [],
    compatibility: {},
    dependencies: {}
  };
  const releaseJson = input.upstreamFiles['release.json'];
  if (releaseJson) {
    try {
      const parsed = JSON.parse(releaseJson.toString('utf8')) as Record<string, unknown>;
      if (typeof parsed.license === 'string' && parsed.license.trim()) {
        merged.license = parsed.license.trim();
      }
      if (typeof parsed.description === 'string' && parsed.description.trim()) {
        merged.description = parsed.description.trim();
      } else if (typeof parsed.displayName === 'string' && parsed.displayName.trim()) {
        merged.description = undefined;
        merged.displayName = String(parsed.displayName).trim();
      }
      if (Array.isArray(parsed.keywords)) {
        merged.keywords = parsed.keywords.filter((value): value is string => typeof value === 'string');
      }
      if (parsed.compatibility && typeof parsed.compatibility === 'object') {
        merged.compatibility = parsed.compatibility as Record<string, unknown>;
      }
      if (parsed.dependencies && typeof parsed.dependencies === 'object') {
        merged.dependencies = parsed.dependencies as Record<string, string>;
      }
    } catch {
      // 非法 release.json：忽略其全部提示，保留平台生成值。
    }
  }
  // release.json 未提供描述时，回退到上游 SKILL.md 的 frontmatter 描述。
  if (!merged.description && input.upstreamFiles['SKILL.md']) {
    const skillMd = validateSkillMd(input.upstreamFiles['SKILL.md'].toString('utf8'));
    if (skillMd.success) merged.description = skillMd.data.description;
  }
  return merged;
}
