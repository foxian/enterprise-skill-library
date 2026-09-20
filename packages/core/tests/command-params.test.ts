import { describe, expect, it } from 'vitest';
import {
  assertNoDuplicateCommandParams,
  parseCommandParams,
  readOptionalStringArrayParam,
  readOptionalStringParam
} from '../src/index.js';

describe('command params', () => {
  it('parses a top-level object containing supported fields', () => {
    expect(parseCommandParams('{"name":"my-skill","keywords":["review"]}', 'init', ['name', 'keywords'])).toEqual({
      name: 'my-skill',
      keywords: ['review']
    });
  });

  it('rejects invalid JSON and non-object payloads', () => {
    expect(() => parseCommandParams('{', 'init', ['name'])).toThrow('expected valid JSON');
    expect(() => parseCommandParams('[]', 'init', ['name'])).toThrow('expected a JSON object');
  });

  it('rejects unsupported fields', () => {
    expect(() => parseCommandParams('{"unknown":true}', 'init', ['name'])).toThrow(
      'unknown parameter unknown'
    );
  });

  it('reads only the documented parameter types', () => {
    expect(readOptionalStringParam({ name: 'my-skill' }, 'name', 'init')).toBe('my-skill');
    expect(readOptionalStringArrayParam({ keywords: ['review'] }, 'keywords', 'init')).toEqual(['review']);
    expect(() => readOptionalStringParam({ name: 1 }, 'name', 'init')).toThrow(
      '"name" must be a string'
    );
    expect(() => readOptionalStringArrayParam({ keywords: ['review', 1] }, 'keywords', 'init')).toThrow(
      '"keywords" must be an array of strings'
    );
  });

  it('rejects a field supplied through both a flag and params JSON', () => {
    expect(() =>
      assertNoDuplicateCommandParams({ license: 'Apache-2.0' }, { license: 'MIT' }, 'init')
    ).toThrow('license cannot be passed both as a flag and in --params-json');
  });
});
