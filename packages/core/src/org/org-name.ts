import type { ValidationResult } from '../schema/validation-result.js';

const ORG_NAME_PATTERN = /^[a-z0-9-]+$/;

const RESERVED_ORG_NAMES = new Set(['admin', 'api', 'git', 'system', 'local', 'builtin']);

export function validateOrgName(name: string): ValidationResult<string> {
  const errors: string[] = [];
  if (name.length < 2 || name.length > 39) {
    errors.push('organization name must be 2-39 characters');
    return { success: false, errors };
  }
  if (!ORG_NAME_PATTERN.test(name)) {
    errors.push('organization name may only contain lowercase letters, digits, and hyphens');
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push('organization name must not start or end with a hyphen');
  }
  if (RESERVED_ORG_NAMES.has(name)) {
    errors.push('organization name is reserved');
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data: name };
}
