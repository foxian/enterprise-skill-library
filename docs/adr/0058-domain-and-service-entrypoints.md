# ESL 服务入口与自托管域名边界

Status: accepted

ESL 需要同时支持 CLI、自动化客户端、浏览器管理用户和企业自部署用户。开源仓库
不能把某个维护者的真实域名、DNS、证书或生产入口当作产品默认值，否则会把某个
私有实例误当成官方公共服务，也会泄露不属于开源项目的部署信息。

## 决策

- ESL Server 对外提供单一用户可见入口；API 与 Git 使用 `/api`、`/git` 路径，
  不要求公开独立的 `api` 或 `git` 用户域名。
- 自托管实例使用部署者自己的域名，例如 `skills.example.com`，或仅在局域网内
  使用 `http://localhost:3000`。域名、DNS、CDN/WAF、TLS、邮件和 Tunnel 均由
  部署者管理，不属于开源仓库的固定资产。
- 公开仓库中的 Docker、Nginx 和 Cloudflare Tunnel 文件只能使用
  `esl.example.com` 等占位域名。真实 hostname 通过私有部署配置或环境变量注入。
- 公开生产入口只提供 HTTPS；HTTP 仅用于重定向。数据库、缓存、内部 API、Git
  Backend 维护入口、容器编排、监控和 SSH 均不公开。
- 局域网或无公网入站端口的部署可以使用 Cloudflare Tunnel，由本机发起出站连接；
  Tunnel 不改变 ESL Server origin，也不要求公开独立的 API/Git 域名。

## 考虑过的方案

- **为开源项目固定一个官方域名**：会把某个实例的运维责任、隐私和生命周期错误地
  绑定到所有使用者；改为占位域名与部署者配置。
- **把 API 和 Git 拆成独立公开域名**：会额外引入 CORS、Cookie、认证回调、Git
  凭据和客户端兼容性边界；保留单一用户可见入口。

## 后果

- 开源项目可以被多个独立实例复用，每个实例拥有自己的域名、租户、数据和运维边界。
- 公开产品层与私有实例层的交付边界、版本锁定和升级流程见
  [ADR-0060](0060-public-product-and-private-instance-boundary.md)。
- 后续实现自定义域名时，必须设计 Host 验证、TLS 证书、认证回调、Cookie 范围、
  租户识别和域名解绑；本 ADR 不把这些能力视为开源项目的默认公共云前置条件。
- ADR-0047 曾允许生产首日先以 HTTP 上线、域名就绪后再启用 TLS；本 ADR 对公开
  生产入口作出更严格的后续约束：正式公开域名必须使用 HTTPS，HTTP 只能作为
  重定向或受控迁移过渡。
