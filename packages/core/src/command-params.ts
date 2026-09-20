export type CommandParams = Record<string, unknown>;

export function parseCommandParams(
  raw: string,
  command: string,
  allowedKeys: readonly string[]
): CommandParams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid --params-json for ${command}: expected valid JSON`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid --params-json for ${command}: expected a JSON object`);
  }

  const params = parsed as CommandParams;
  const unknownKeys = Object.keys(params).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid --params-json for ${command}: unknown parameter${unknownKeys.length === 1 ? '' : 's'} ${unknownKeys.join(', ')}`
    );
  }
  return params;
}

export function readOptionalStringParam(
  params: CommandParams,
  key: string,
  command: string
): string | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid --params-json for ${command}: "${key}" must be a string`);
  }
  return value;
}

export function readOptionalStringArrayParam(
  params: CommandParams,
  key: string,
  command: string
): string[] | undefined {
  const value = params[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Invalid --params-json for ${command}: "${key}" must be an array of strings`);
  }
  return value;
}

export function assertNoDuplicateCommandParams(
  params: CommandParams,
  explicitFlags: Record<string, unknown>,
  command: string
): void {
  const duplicates = Object.entries(explicitFlags)
    .filter(([key, value]) => value !== undefined && params[key] !== undefined)
    .map(([key]) => key);
  if (duplicates.length > 0) {
    throw new Error(
      `Parameter${duplicates.length === 1 ? '' : 's'} ${duplicates.join(', ')} cannot be passed both as a flag and in --params-json`
    );
  }
}
