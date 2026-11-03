// 外部 Git 抓取的网络安全边界（ADR-0074）：只允许公网 HTTPS，禁止本机、私网、
// 链路本地与云元数据地址。校验本身不做内容信任，只防止 importer 成为进入内网的路径。

export class ExternalSourceNetworkError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'ExternalSourceNetworkError';
  }
}

// 校验初始 URL：必须是 https、不能携带凭据、主机名非空。真正的 IP 可达性（DNS
// 解析后是否为公网）由抓取器在解析后用 assertPublicIpAddress 复核。
export function assertPublicHttpsGitUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExternalSourceNetworkError(`Invalid repository URL: ${rawUrl}`, 'externalSourceInvalidUrl');
  }
  if (url.protocol !== 'https:') {
    throw new ExternalSourceNetworkError('Only public HTTPS repositories are supported', 'externalSourceHttpsRequired');
  }
  if (url.username || url.password) {
    throw new ExternalSourceNetworkError(
      'Repository URLs must not contain credentials',
      'externalSourceCredentialsForbidden'
    );
  }
  if (!url.hostname) {
    throw new ExternalSourceNetworkError('Repository URL is missing a host', 'externalSourceInvalidUrl');
  }
  return url;
}

interface ParsedIp {
  version: 4 | 6;
  parts: number[];
}

function parseIpv4(ip: string): number[] | null {
  const segments = ip.split('.');
  if (segments.length !== 4) return null;
  const parts: number[] = [];
  for (const segment of segments) {
    if (!/^\d{1,3}$/.test(segment)) return null;
    const value = Number(segment);
    if (value > 255) return null;
    parts.push(value);
  }
  return parts;
}

function parseIp(ip: string): ParsedIp | null {
  const v4 = parseIpv4(ip);
  if (v4) return { version: 4, parts: v4 };

  let normalized = ip.toLowerCase();
  // IPv4-mapped / compatible：解出尾部 IPv4 后按对应规则判断。
  const mappedMatch = normalized.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) {
    const v4Parts = parseIpv4(mappedMatch[1]);
    if (!v4Parts) return null;
    // ::a.b.c.d（compatible，非 ffff）把 IPv4 映射进 v6；仍按其字面 IPv4 判定。
    return { version: 4, parts: v4Parts };
  }

  if (normalized.includes('.')) return null;
  // 展开 ::。
  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const halves = normalized.includes('::')
    ? normalized.split('::')
    : [normalized, undefined];
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const parts: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    parts.push(parseInt(group, 16));
  }
  return { version: 6, parts };
}

function isPrivateOrReservedIpv4(p: number[]): boolean {
  const [a, b] = p;
  if (p[0] === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true; // 192.0.0.0/24, TEST-NET-1
  if (a === 198 && (b === 51 || b === 18)) return true; // TEST-NET-2 / benchmarking
  if (a === 203 && b === 0 && p[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

function isPrivateOrReservedIpv6(p: number[]): boolean {
  // 每组拆成高低字节便于比较。
  const bytes: number[] = p.flatMap((group) => [group >> 8, group & 0xff]);
  if (bytes.every((byte) => byte === 0)) return true; // ::（含 ::1 之外的全零）
  // ::1：前 15 字节全 0，末字节为 1。
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xff) return true; // multicast
  // IPv4-mapped ::ffff:a.b.c.d
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateOrReservedIpv4(bytes.slice(12));
  }
  // 6to4 2002::/16：取出内嵌 IPv4（第3、4字节）判定。
  if (p[0] === 0x2002) {
    return isPrivateOrReservedIpv4([bytes[2], bytes[3], 0, 0]);
  }
  return false;
}

// 判断某个已解析的 IP 是否为公网可路由地址。
export function isPublicIpAddress(ip: string): boolean {
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return parsed.version === 4
    ? !isPrivateOrReservedIpv4(parsed.parts)
    : !isPrivateOrReservedIpv6(parsed.parts);
}

// 抓取器在 DNS 解析后、每次重定向后调用；命中禁址即失败并停止抓取。
export function assertPublicIpAddress(ip: string): void {
  if (!isPublicIpAddress(ip)) {
    throw new ExternalSourceNetworkError(
      `Refusing to connect to non-public address: ${ip}`,
      'externalSourceForbiddenAddress'
    );
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

// 解析主机名并校验其全部解析结果都是公网地址。IP 字面量直接校验，不触发 DNS。
// 由抓取器在任何网络访问前调用；禁用重定向后不存在"每次重定向"的二次检查面。
export async function assertPublicHost(hostname: string, lookup: HostLookup): Promise<void> {
  const normalized = hostname.replace(/^\[|\]$/g, '');
  if (parseIp(normalized)) {
    assertPublicIpAddress(normalized);
    return;
  }
  const addresses = await lookup(normalized);
  if (addresses.length === 0) {
    throw new ExternalSourceNetworkError(
      `Could not resolve repository host: ${hostname}`,
      'externalSourceRepositoryNotFound'
    );
  }
  for (const address of addresses) {
    assertPublicIpAddress(address);
  }
}

