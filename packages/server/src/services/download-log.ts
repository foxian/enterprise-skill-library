// 下载日志的客户端元数据解析（ADR-0067）。这两件事都必须在落库之前完成：
// 截断 IP 是为了不承担全量 IP 的个人数据合规义务，解析 User-Agent 是为了把
// 客户端环境拆成可分字段分析的维度而不是一团不可检索的字符串。

export interface ClientEnvironment {
  osPlatform: string | null;
  osArch: string | null;
  eslVersion: string | null;
  nodeVersion: string | null;
}

const EMPTY_ENVIRONMENT: ClientEnvironment = {
  osPlatform: null,
  osArch: null,
  eslVersion: null,
  nodeVersion: null
};

// ESL CLI 上报 `esl/<版本> node/<版本> <platform>/<arch>`。逐 token 解析而非整体
// 匹配：契约里任一 token 缺失或损坏时，其余字段仍应正确落库，只有失败的字段为
// null——这直接对应 ADR-0067「解析失败的字段为 null」的口径。
export function parseClientUserAgent(userAgent: string | undefined): ClientEnvironment {
  if (!userAgent) return { ...EMPTY_ENVIRONMENT };
  const environment: ClientEnvironment = { ...EMPTY_ENVIRONMENT };
  for (const token of userAgent.trim().split(/\s+/)) {
    const separator = token.indexOf('/');
    if (separator <= 0) continue;
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (!value) continue;
    if (key === 'esl') {
      environment.eslVersion ??= value;
    } else if (key === 'node') {
      environment.nodeVersion ??= value;
    } else if (environment.osPlatform === null) {
      environment.osPlatform = key;
      environment.osArch = value;
    }
  }
  return environment;
}

// 截断发生在落库之前，任何路径都不存全量 IP：IPv4 保留 /24 段、IPv6 保留 /48 段
// （ADR-0067）。返回 CIDR 形式的网段，让"这是截断值"在数据里自解释。无法识别的
// 输入返回 null——宁可丢一个来源维度，也不落一个可能是全量 IP 的字符串。
export function truncateClientIp(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  // IPv4 映射的 IPv6（::ffff:203.0.113.5）按 IPv4 处理，否则会退化成
  // ::ffff:0:0/48 这种丢掉全部来源信息的网段。
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  const address = mapped ? mapped[1] : value;
  const ipv4 = parseIpv4(address);
  if (ipv4) return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
  const ipv6 = parseIpv6(address);
  if (ipv6) {
    const prefix = ipv6
      .slice(0, 3)
      .map((group) => parseInt(group, 16).toString(16))
      .join(':');
    return `${prefix}::/48`;
  }
  return null;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? (octets as [number, number, number, number]) : null;
}

// 把压缩写法展开成 8 组，便于取前 48 位；无法规范化时返回 null。
function parseIpv6(value: string): string[] | null {
  const address = value.split('%')[0];
  if (!address.includes(':') || !/^[0-9a-fA-F:]+$/.test(address)) return null;
  const [head, tail, ...rest] = address.split('::');
  if (rest.length > 0) return null;
  const headGroups = head ? head.split(':') : [];
  if (tail === undefined) {
    return headGroups.length === 8 ? headGroups : null;
  }
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  return [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
}
