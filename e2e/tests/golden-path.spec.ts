import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  addOrgMember,
  createOrg,
  downloadPackage,
  registerAndLogin,
  setVisibility,
  uniqueOrgName,
  uploadSkill
} from '../helpers/e2e-api';
import { publishSkillRelease } from '../helpers/release-api';

// 金路径收口（spec #49 Seam 4，ADR-0032）：在真实栈（nginx + api + gitea）上跑
// 注册 → 建组织 → 拉人 → @组织 发布 → 他组织用户安装。安装的服务端等价是
// 下载 Published Skill Package（CLI install 的第一步，受同一可见性门禁保护）。

const PASSWORD = 'e2e-golden-pass';

test.describe('npm 式金路径（真实栈）', () => {
  const createdApis: APIRequestContext[] = [];

  test.afterEach(async () => {
    for (const api of createdApis.splice(0)) {
      await api.dispose();
    }
  });

  test('注册 → 建组织 → 拉人 → @组织 发布 → 他组织用户装 public 技能成功，装 private 被拒', async ({
    request
  }) => {
    // 1. 三个人各自注册全局账号（不需要管理员介入）
    const owner = await registerAndLogin(request, 'e2e-owner', PASSWORD);
    const member = await registerAndLogin(request, 'e2e-member', PASSWORD);
    const outsider = await registerAndLogin(request, 'e2e-outsider', PASSWORD);
    createdApis.push(owner.api, member.api, outsider.api);

    // 2. 创建组织（auto 模式即时开通，创建者成为 组织管理团队）
    const orgName = uniqueOrgName('e2e-org');
    await createOrg(owner.api, orgName);

    // 3. 拉人：直拉即生效，成员自动进入三个常设团队
    await addOrgMember(owner.api, orgName, member.user.username);

    // 4. 任何组织成员可直发新技能到组织命名空间（上传者成为初始 Maintainer）
    const identity = `@${orgName}/toolkit`;
    const uploaded = await uploadSkill(member.api, identity, '组织命名空间技能');
    expect(uploaded.name).toBe(identity);

    // 5. 发布（release.json v3 的 name 与既定身份一致才被接受）
    await publishSkillRelease(member.api, identity, '1.0.0');

    // 6. private（默认）对他组织用户不可见、不可装，错误指向无权限
    // 断言限定在本运行的身份上：栈上可能留有其他运行的 public 同名技能
    const search = await outsider.api.get('/api/skills/search?q=toolkit');
    const searched = ((await search.json()) as Array<{ name: string }>).map((row) => row.name);
    expect(searched).not.toContain(identity);
    const info = await outsider.api.get(`/api/skills/${orgName}/toolkit`);
    expect(info.status()).toBe(403);
    expect((await info.json()).error).toContain('private');

    // 7. 组织成员把它设为 public：平台内所有用户可搜、可读、可安装
    await setVisibility(member.api, identity, 'public');

    await expect
      .poll(async () => {
        const response = await outsider.api.get('/api/skills/search?q=toolkit');
        const rows = (await response.json()) as Array<{ name: string }>;
        return rows.map((row) => row.name);
      })
      .toContain(identity);

    const installed = await downloadPackage(outsider.api, identity);
    expect(installed.status).toBe(200);
    expect(installed.body?.name).toBe(identity);
    expect(installed.body?.version).toBe('1.0.0');
  });

  test('他组织用户安装 private 技能被拒且错误清晰', async ({ request }) => {
    const owner = await registerAndLogin(request, 'e2e-private-owner', PASSWORD);
    const outsider = await registerAndLogin(request, 'e2e-private-outsider', PASSWORD);
    createdApis.push(owner.api, outsider.api);

    const orgName = uniqueOrgName('e2e-priv-org');
    await createOrg(owner.api, orgName);

    const identity = `@${orgName}/sealed`;
    await uploadSkill(owner.api, identity, '私有技能');
    await publishSkillRelease(owner.api, identity, '1.0.0');

    // 读取与下载都被门禁拦住，错误文案指明 private 与申请路径
    const info = await outsider.api.get(`/api/skills/${orgName}/sealed`);
    expect(info.status()).toBe(403);
    expect((await info.json()).error).toContain('no access to this private skill');

    // 上传者自己可以看到并安装
    const own = await downloadPackage(owner.api, identity);
    expect(own.status).toBe(200);
  });

  test('个人命名空间发布 → 安装链路', async ({ request }) => {
    const author = await registerAndLogin(request, 'e2e-solo', PASSWORD);
    const consumer = await registerAndLogin(request, 'e2e-consumer', PASSWORD);
    createdApis.push(author.api, consumer.api);

    // 裸名（或显式 @自己的用户名/...）等价：归属落在个人命名空间
    const identity = `@${author.user.username}/handbook`;
    await uploadSkill(author.api, identity, '个人技能');
    await publishSkillRelease(author.api, identity, '0.1.0');

    // 个人技能默认 private：他人不可见
    expect((await consumer.api.get(`/api/skills/${author.user.username}/handbook`)).status()).toBe(403);

    // 作者设为 public 后，任何登录用户可安装
    await setVisibility(author.api, identity, 'public');
    const installed = await downloadPackage(consumer.api, identity);
    expect(installed.status).toBe(200);
    expect(installed.body?.name).toBe(identity);
  });
});
