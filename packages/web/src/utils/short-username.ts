// 组织内展示用短名:Gitea 用户名形如 <org>_<name>(如 acme_bob),
// 在组织内部视角剥掉组织前缀只显示 <name>(如 bob)。
// 仅用于展示;data-test 标识与 API 调用仍使用完整用户名。
export function shortUsername(org: string | null | undefined, username: string): string {
  if (!org) {
    return username;
  }
  return username.startsWith(`${org}_`) ? username.slice(org.length + 1) : username;
}
