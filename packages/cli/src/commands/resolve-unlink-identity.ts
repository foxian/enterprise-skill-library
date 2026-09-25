import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists, validateReleaseManifest } from '@esl/core';

export interface ResolveUnlinkIdentityOptions {
  /** 默认 process.cwd()；测试可注入，避免依赖 chdir */
  cwd?: string;
}

export interface ResolvedUnlinkTarget {
  identity: string;
  /** 是否从技能目录的 release.json 推导（含省略 / . / 路径） */
  fromDirectory: boolean;
  /** 推导时使用的绝对技能目录；显式 @identity 时为 null */
  skillDir: string | null;
  /** 调用方传入 undefined 或 '.'（脚枪提示用） */
  usedOmitOrDot: boolean;
}

function completeBareIdentity(name: string): string {
  if (name.startsWith('@')) {
    return name;
  }
  return `@local/${name}`;
}

async function identityFromSkillDir(skillDir: string): Promise<string> {
  const releasePath = path.join(skillDir, 'release.json');
  if (!(await fileExists(releasePath))) {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: release.json is missing; pass @scope/skill-name explicitly`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(releasePath, 'utf8'));
  } catch {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: release.json is not valid JSON; pass @scope/skill-name explicitly`
    );
  }

  const validation = validateReleaseManifest(parsed);
  if (!validation.success) {
    throw new Error(
      `Cannot infer skill identity from ${skillDir}: ${validation.errors.join(', ')}; pass @scope/skill-name explicitly`
    );
  }

  return completeBareIdentity(validation.data.name);
}

export async function resolveUnlinkIdentity(
  target: string | undefined,
  options: ResolveUnlinkIdentityOptions = {}
): Promise<ResolvedUnlinkTarget> {
  const cwd = options.cwd ?? process.cwd();

  if (typeof target === 'string' && target.startsWith('@')) {
    return {
      identity: target,
      fromDirectory: false,
      skillDir: null,
      usedOmitOrDot: false
    };
  }

  const usedOmitOrDot = target === undefined || target === '.';
  const skillDir = usedOmitOrDot ? path.resolve(cwd) : path.resolve(cwd, target as string);
  const identity = await identityFromSkillDir(skillDir);
  return {
    identity,
    fromDirectory: true,
    skillDir,
    usedOmitOrDot
  };
}
