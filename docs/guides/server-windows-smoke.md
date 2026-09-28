# Server Windows 冒烟 runbook

ADR-0053 把 ESL Server 在 Windows 上的支持定为 **T2（验证级）**：不进常规
CI，但**每个发布版本前**由维护者在本机 Windows 宿主上执行一次本检查单。
GitHub 托管的 Windows runner 跑不了 Linux 容器，因此这一步只能人工执行。

支持形态仅限 **Docker Desktop on Windows**；原生 Node 部署不受支持，不要
尝试也不要为它开特例。

## 前置条件

- Windows 10/11，Docker Desktop 正在运行（WSL2 后端）
- Node.js 24、npm、Git for Windows
- 3000 / 3001 端口空闲（3001 是开发态 Git Backend 直连口）
- 干净的工作目录（建议新 clone 一份，避免污染日常开发环境）

## 检查单

1. **构建**
   ```powershell
   npm ci
   npm run build
   ```

2. **启动完整 compose 栈**（含 Git Backend、bootstrap、API、nginx）：
   ```powershell
   copy .env.example .env   # 首次；按需改端口与数据目录
   docker compose up -d
   docker compose ps        # 等到各服务 healthy / running
   ```

3. **基础连通**（对应生产 smoke 脚本的 Windows 手工版）：
   ```powershell
   (Invoke-WebRequest -UseBasicParsing http://localhost:3000/health).StatusCode   # 200
   (Invoke-WebRequest -UseBasicParsing -Method Post -ContentType "application/json" `
     -Body '{"username":"x","password":"y"}' http://localhost:3000/api/auth/login).StatusCode
   # 登录接口返回任意非 5xx（401/400 均算通过——验证的是服务可达与路由完整）
   ```

4. **核心用户路径**：浏览器打开 `http://localhost:3000/admin/`，完成一次
   注册 → 登录 → 个人控制台可见；Git Backend 维护入口可达。若本机装有
   Playwright 与系统 Chrome，可改跑 `npx playwright test e2e/golden-path`
   代替手工路径。

5. **持久卷核对**：
   ```powershell
   docker compose restart api
   docker compose ps          # api 恢复 healthy
   ```
   确认 `data\api`、`data\gitea`、`data\secrets` 三个宿主目录已生成，且
   重启后已注册账号仍能登录（数据不丢）。

6. **收尾**：`docker compose down`（保留卷）。在发布记录中注明「Windows
   T2 冒烟通过 + 日期 + Windows 版本」。

## 失败处理

任何一步失败即视为该版本**不满足 Windows T2 承诺**：按
[docker-troubleshooting](docker-troubleshooting.md) 排查；属于平台缺陷的
在发布前修复或降级说明，不得带病发布。
