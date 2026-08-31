import { describe, expect, it } from 'vitest';
import { validateOrgName } from '../src/index.js';

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
