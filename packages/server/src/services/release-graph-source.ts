import {
  ReleaseGraphError,
  type ReleaseGraphNode,
  type ReleaseGraphSource
} from '@esl/core';
import type { SkillRepository } from '../db/database.js';
import type { GiteaService } from './gitea.js';
import { hasReadAccess } from './skill-access.js';

// 发布冻锁的服务器图源（ADR-0056）：以发布者身份读取——身份不存在、没有
// 已发布 Release 或发布者无权读取时，抛稳定错误码，不静默忽略。
export class ServerReleaseGraphSource implements ReleaseGraphSource {
  constructor(
    private readonly repository: SkillRepository,
    private readonly giteaService: GiteaService,
    private readonly username: string
  ) {}

  async listVersions(identity: string): Promise<string[]> {
    const skill = this.repository.getSkill(identity);
    if (!skill) {
      throw new ReleaseGraphError('releaseDependencyNoRelease', { identity });
    }
    if (!(await hasReadAccess(this.giteaService, skill, this.username))) {
      throw new ReleaseGraphError('releaseDependencyNotVisible', { identity });
    }
    return this.repository.getReleases(identity).map((release) => release.version);
  }

  async load(identity: string, version: string): Promise<ReleaseGraphNode> {
    const skill = this.repository.getSkill(identity);
    const release = this.repository.getRelease(identity, version);
    if (!skill || !release) {
      throw new ReleaseGraphError('releaseDependencyNoRelease', { identity });
    }
    const manifest = release.releaseManifest as { dependencies?: Record<string, string> };
    return {
      identity,
      skillId: release.skillId,
      version,
      checksum: release.checksum,
      visibility: skill.visibility === 'private' ? 'private' : 'public',
      dependencies: manifest.dependencies ?? {}
    };
  }
}
