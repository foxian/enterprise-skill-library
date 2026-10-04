# 官方公共 ESL 云的域名与服务入口

Status: accepted

ESL 需要同时面向公开访客、CLI 和自动化客户端、浏览器管理用户，以及未来的
企业自部署用户。若官网、API、Git Backend 和管理界面共享没有明确边界的地址，
会使内容 canonical URL、ESL Server origin、认证边界和企业部署迁移互相耦合。

## 决策

- `www.enterprise-skills.com` 是官方公共内容入口，承载产品官网、公开技能只读
  目录和页面，以及下载导航。根域名 `enterprise-skills.com` 只做 HTTPS 301
  跳转到 `www`，不与 `www` 承载两份独立内容。
- `cloud.enterprise-skills.com` 是官方公共 ESL 云的长期稳定 ESL Server origin，
  面向没有自建私有 ESL 的企业提供多租户技能库服务。CLI、自动化客户端、Registry
  API、Git 流量和 Web 管理界面共用该用户可见入口；API 与 Git 继续使用
  `/api`、`/git` 路径，不公开独立的 `api` 或 `git` 用户入口。
- 浏览器管理界面首期使用 `https://cloud.enterprise-skills.com/admin`，不单独
  启用 `console.enterprise-skills.com`。`admin.enterprise-skills.com` 也不作为
  首期公开入口；平台管理仍由应用认证与授权控制。
- `docs.enterprise-skills.com` 是文档入口，`status.enterprise-skills.com` 是
  公共云状态入口。下载从官网导航到 npm 或 GitHub Release，不首期增加独立下载
  子域名。
- 公开技能的内容 canonical URL 位于 `www`；登录、安装、发布、组织管理和其他
  需要鉴权的操作回到 `cloud`。官网与公共云可以共享产品身份，但不依赖整个
  `.enterprise-skills.com` 域的共享认证 Cookie。
- 企业自部署的 ESL Server 使用企业自己的域名，例如 `skills.acme.com`，而不
  把企业自部署生命周期绑定到官方公共云 DNS。未来官方托管的专属企业实例可以
  使用 `acme.cloud.enterprise-skills.com`，并可进一步支持企业自定义域名；这不
  改变 `cloud.enterprise-skills.com` 的公共云稳定入口。
- 区域是未来的内部部署和路由概念；首期不公开 `cn.cloud.enterprise-skills.com`
  或 `us.cloud.enterprise-skills.com` 等区域入口。
- 公开生产入口只提供 HTTPS；HTTP 仅用于重定向。DNS、CDN/WAF 和 TLS 证书由组织
  管理的专业基础设施托管，并采用自动续期；数据库、缓存、内部 API、Git Backend
  维护入口、容器编排、监控和 SSH 均不公开。
- 注册邮箱验证、密码重置和组织邀请等事务邮件使用独立的
  `mail.enterprise-skills.com` 发信域，并由可替换的外部事务邮件服务通过 API 或
  SMTP 提交；ESL Server 不自建邮件投递系统。`support@enterprise-skills.com`
  是由企业邮箱托管的人工支持收件地址。
- 域名、DNS、邮箱和第三方服务账号当前可以由个人持有，但应规划迁移到公司或
  长期组织主体，并配置可交接的管理员和恢复信息。邮件服务商、DNS/CDN 厂商和
  具体价格不是 ESL 领域依赖。

## 考虑过的方案

- **使用 `app.enterprise-skills.com` 作为公共服务入口**：`app` 只表达网页应用，
  不能清楚表达同一入口还承载 CLI、自动化、API 和 Git；采用 `cloud` 表达官方
  托管的公共技能云。
- **把 API 和 Git 拆成独立公开域名**：会额外引入 CORS、Cookie、认证回调、Git
  凭据和客户端兼容性边界；保留 ESL Server 的单一用户可见入口。
- **让每个公共云组织默认拥有子域名**：会增加租户寻址、证书、Cookie 和 OAuth
  回调复杂度；首期通过账号、组织标识、Namespace 和授权模型区分组织。
- **在 ESL Server 上自建 SMTP**：需要自行承担 IP 声誉、退信、重试、黑名单和投递
  监控；改为可替换的外部事务邮件服务。企业邮箱与事务发信也保持职责分离。
- **公开区域域名作为用户默认入口**：会把区域迁移暴露给 CLI 和自动化配置；保留
  `cloud` 作为稳定入口，区域留在内部路由层。

## 后果

- 公共云的客户端文档可以给出稳定的 `https://cloud.enterprise-skills.com`
  配置示例，服务底层迁移不应要求用户频繁修改 ESL Server origin。
- 官网与公共云可以独立部署，公开内容和核心服务可以分别扩展、缓存和发布。
- 后续实现自定义域名时，必须额外设计 Host 验证、TLS 证书、认证回调、Cookie
  范围、租户识别和域名解绑；本 ADR 不把这些能力视为首期公共云前置条件。
- 首期面向中国大陆用户时，可选择中国大陆可达的 DNS、邮箱和事务邮件供应商；
  通过配置抽象保留海外区域和供应商切换能力，并按实际数据驻留要求评估。
- ADR-0047 曾允许生产首日先以 HTTP 上线、域名就绪后再启用 TLS；本 ADR 对公开
  生产入口作出更严格的后续约束：正式公开域名必须使用 HTTPS，HTTP 只能作为
  重定向或受控迁移过渡。