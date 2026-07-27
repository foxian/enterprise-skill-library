import { describe, expect, it } from 'vitest';
import { parseSkillName, validateSkillJson } from '../src/index.js';

describe('skill.json validation', () => {
  it('accepts valid ESL package metadata', () => {
    const result = validateSkillJson({
      name: '@myorg/debugging-helper',
      version: '1.2.0',
      description: 'Systematic debugging skill',
      author: 'zhangsan',
      license: 'MIT',
      keywords: ['debugging', 'testing'],
      compatibility: {
        tools: ['codex', 'claude-code'],
        languages: ['typescript']
      },
      dependencies: {
        '@myorg/test-utils': '^1.0.0'
      },
      repository: 'git@skills.company.com:myorg/debugging-helper.git'
    });

    expect(result.success).toBe(true);
  });

  it('rejects unscoped skill names', () => {
    const result = validateSkillJson({
      name: 'debugging-helper',
      version: '1.2.0',
      description: 'Systematic debugging skill',
      author: 'zhangsan'
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid versions and empty descriptions', () => {
    const result = validateSkillJson({
      name: '@myorg/debugging-helper',
      version: '1.2',
      description: '',
      author: 'zhangsan'
    });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('version'),
        expect.stringContaining('description')
      ])
    );
  });

  it('parses scoped skill names', () => {
    expect(parseSkillName('@frontend-team/react-component-gen')).toEqual({
      scope: 'frontend-team',
      skillName: 'react-component-gen'
    });
  });
});
