import { describe, expect, it } from 'vitest';
import { highestSatisfyingVersion, highestStableVersion, sortVersionsDescending } from '../src/index.js';

describe('highestStableVersion', () => {
  it('picks the highest release and ignores prereleases', () => {
    expect(highestStableVersion(['1.0.0', '1.2.0', '2.0.0-beta.1'])).toBe('1.2.0');
  });

  it('compares numerically rather than lexicographically', () => {
    expect(highestStableVersion(['1.0.0', '1.10.0', '1.9.0'])).toBe('1.10.0');
  });

  it('does not depend on the order the versions arrive in', () => {
    expect(highestStableVersion(['1.9.0', '1.10.0', '1.0.0'])).toBe('1.10.0');
  });

  it('returns undefined when there is only a prerelease', () => {
    expect(highestStableVersion(['2.0.0-beta.1'])).toBeUndefined();
  });

  it('returns undefined when there are no versions', () => {
    expect(highestStableVersion([])).toBeUndefined();
  });

  it('ignores entries that are not valid SemVer', () => {
    expect(highestStableVersion(['not-a-version', '1.0.0'])).toBe('1.0.0');
  });
});

describe('sortVersionsDescending', () => {
  it('lists versions newest first, including prereleases', () => {
    expect(sortVersionsDescending(['1.0.0', '1.10.0', '1.9.0', '2.0.0-beta.1'])).toEqual([
      '2.0.0-beta.1',
      '1.10.0',
      '1.9.0',
      '1.0.0'
    ]);
  });

  it('keeps entries that are not valid SemVer at the end', () => {
    expect(sortVersionsDescending(['1.0.0', 'not-a-version'])).toEqual(['1.0.0', 'not-a-version']);
  });
});

describe('highestSatisfyingVersion', () => {
  it('picks the highest version satisfying the range, not the first match', () => {
    expect(highestSatisfyingVersion(['1.0.0', '1.2.0', '1.5.0'], '^1.0.0')).toBe('1.5.0');
  });

  it('returns undefined when nothing satisfies the range', () => {
    expect(highestSatisfyingVersion(['2.0.0'], '^1.0.0')).toBeUndefined();
  });

  it('does not satisfy a plain range with a prerelease', () => {
    expect(highestSatisfyingVersion(['1.0.0', '1.1.0-rc.1'], '^1.0.0')).toBe('1.0.0');
  });
});
