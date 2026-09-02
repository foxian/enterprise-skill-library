import { describe, expect, it } from 'vitest';
import {
  buildGiteaUsername,
  validateMemberUsername,
  validateOrgName,
  validatePassword
} from '../src/index.js';

describe('organization name validation', () => {
  it('accepts valid organization names', () => {
    for (const name of ['acme', 'platform-ai', 'a1', 'ab', 'a'.repeat(39)]) {
      expect(validateOrgName(name).success).toBe(true);
    }
  });

  it('rejects names that are too short or too long', () => {
    expect(validateOrgName('a').success).toBe(false);
    expect(validateOrgName('a'.repeat(40)).success).toBe(false);
  });

  it('rejects names containing characters other than lowercase letters, digits, and hyphens', () => {
    expect(validateOrgName('Acme').success).toBe(false);
    expect(validateOrgName('acme_corp').success).toBe(false);
    expect(validateOrgName('acme corp').success).toBe(false);
  });

  it('rejects names starting or ending with a hyphen', () => {
    expect(validateOrgName('-acme').success).toBe(false);
    expect(validateOrgName('acme-').success).toBe(false);
  });

  it('rejects reserved system names', () => {
    for (const name of ['admin', 'api', 'git', 'system', 'local', 'builtin']) {
      expect(validateOrgName(name).success).toBe(false);
    }
  });

  it('returns descriptive error messages', () => {
    const result = validateOrgName('acme_corp');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toMatch(/lowercase letters, digits, and hyphens/);
    }
  });
});

describe('account and password policy', () => {
  it('accepts passwords at or above the configured minimum length', () => {
    expect(validatePassword('a'.repeat(12), 12).success).toBe(true);
    expect(validatePassword('a'.repeat(20), 12).success).toBe(true);
  });

  it('rejects passwords below the configured minimum length', () => {
    const result = validatePassword('a'.repeat(11), 12);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.join(' ')).toContain('at least 12 characters');
    }
  });

  it('validates local member usernames with the organization naming alphabet', () => {
    expect(validateMemberUsername('alice').success).toBe(true);
    expect(validateMemberUsername('platform-ai').success).toBe(true);
    expect(validateMemberUsername('admin').success).toBe(false);
    expect(validateMemberUsername('Alice').success).toBe(false);
    expect(validateMemberUsername('alice_user').success).toBe(false);
  });

  it('builds the canonical Gitea username for organization members', () => {
    expect(buildGiteaUsername('acme', 'alice')).toBe('acme_alice');
    expect(buildGiteaUsername('acme', 'admin')).toBe('acme_admin');
  });

  it('rejects a canonical Gitea username longer than 255 characters', () => {
    const result = buildGiteaUsername('a'.repeat(39), 'b'.repeat(216));
    expect(result).toBeNull();
  });
});
