import semver from 'semver';

/**
 * The Skill Release a Skill User gets by default: the highest published version
 * that is not a prerelease. Prereleases are installable only when a version is
 * requested explicitly.
 */
export function highestStableVersion(versions: readonly string[]): string | undefined {
  return versions
    .filter((version) => semver.valid(version) !== null && semver.prerelease(version) === null)
    .sort(semver.rcompare)[0];
}

/**
 * Published versions newest first, so a version listing reads the same wherever
 * it is shown. Entries that are not valid SemVer sort to the end.
 */
export function sortVersionsDescending(versions: readonly string[]): string[] {
  return [...versions].sort((left, right) => {
    const leftValid = semver.valid(left) !== null;
    const rightValid = semver.valid(right) !== null;
    if (!leftValid || !rightValid) {
      return leftValid === rightValid ? 0 : leftValid ? -1 : 1;
    }
    return semver.rcompare(left, right);
  });
}

/**
 * The version a dependency range resolves to: the highest published version that
 * satisfies the range. Used when freezing a Release Dependency Lock.
 */
export function highestSatisfyingVersion(
  versions: readonly string[],
  range: string
): string | undefined {
  return versions
    .filter((version) => semver.valid(version) !== null && semver.satisfies(version, range))
    .sort(semver.rcompare)[0];
}
