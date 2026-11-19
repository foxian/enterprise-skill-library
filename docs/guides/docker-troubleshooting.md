# Docker Troubleshooting

For normal local setup and startup, follow
[Local Development Runtime](local-development.md). This guide covers Docker
Desktop, proxy, image-pull, and backend recovery issues only.

## Prerequisites

- Windows 10/11
- Docker Desktop
- Node.js 24（推荐；完整仓库需要 ≥22。官方镜像为 node:24-bookworm-slim）
- npm
- Git for Windows

The Docker CLI does not need WSL. If it is not in `PATH`, use:

```powershell
& "C:\Users\cnfox\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose ps
```

## npm Proxy During Docker Builds

`127.0.0.1` inside a Docker build container points at the container, not the
Windows host. A host proxy such as `127.0.0.1:7897` therefore cannot be used
directly by npm in a container.

When the local network requires a proxy, set this in `.env`:

```dotenv
NPM_PROXY=http://host.docker.internal:7897
```

`host.docker.internal` is the Docker Desktop hostname for reaching the Windows
host. Leave `NPM_PROXY` blank when Docker can reach npm registries directly.

## Image Pull Failures

If Docker cannot pull base images, configure a Docker Desktop registry mirror
in:

```text
C:\Users\<用户名>\.docker\daemon.json
```

For example:

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://docker.nju.edu.cn",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
```

Restart Docker Desktop, then verify the active configuration:

```powershell
docker info
```

The output should include `Registry Mirrors`.

## Debian Package Fetch Failures During Builds

When `docker compose build api` fails in the `apt-get update && apt-get install`
layer with `502 Bad Gateway` from `deb.debian.org` (Fastly edge IPs) or
`Connection failed` from a mirror, the upstream package CDN is flaky from your
network. `Acquire::Retries` does not reliably help, and Docker Desktop's
built-in proxy (`http.docker.internal:3128`, shown as `HTTP Proxy` in
`docker info`) can add another failure point. Direct access may still hit
intermittent 502s.

Build from a temporary copy of the Dockerfile that points the base image's
Debian sources at a reachable mirror, with the Docker Desktop proxy bypassed.
The tracked `packages/server/Dockerfile` stays unchanged:

```bash
# 1. Copy the Dockerfile and add a mirror switch before apt-get update in the
#    first RUN, e.g. for bookworm's deb822 source file:
#      sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' \
#        /etc/apt/sources.list.d/debian.sources
cp packages/server/Dockerfile docker/tmp-server-build.Dockerfile
# ...edit docker/tmp-server-build.Dockerfile to add the sed line...

# 2. Build with the compose image tag, bypassing the proxy:
docker build -f docker/tmp-server-build.Dockerfile -t enterprise-skill-library-api \
  --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg NO_PROXY='*' .

# 3. Recreate api, then restart nginx so it re-resolves the api hostname:
docker compose up -d api
docker compose restart server

# 4. Clean up the temporary Dockerfile:
rm docker/tmp-server-build.Dockerfile
```

Verify with `curl -o /dev/null -w '%{http_code}\n' http://localhost:4070/health`.

Any reachable Debian mirror works; keep both the `/debian` and
`/debian-security` URLs pointing at the same host.

## Runtime Diagnosis

Use these commands after following the normal startup procedure:

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f gitea
docker compose logs gitea-bootstrap
docker compose restart api
docker compose down
docker compose down -v
docker compose build --no-cache api
```

`gitea-bootstrap` is a one-time setup service. `Exited (0)` after a successful
bootstrap is expected.

## Gitea Recovery Access

Gitea stays internal during normal ESL use. To expose it temporarily for
backend recovery or diagnosis, start the debug override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build
```

Gitea is then available at `http://localhost:3001`. Sign in as `eslroot` with
the `GITEA_ADMIN_PASSWORD` value from `.env`. Continue using the ESL Server at
`http://localhost:4070` for normal API and Git workflows.

Change the ESL Administrator Account password through ESL rather than editing
runtime storage: sign in to the Admin Console (`http://localhost:4070/admin`) as
the administrator account and change it under 平台设置 (Platform Settings). The
CLI does not host the platform administrator.
