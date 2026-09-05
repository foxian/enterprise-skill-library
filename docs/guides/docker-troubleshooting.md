# Docker Troubleshooting

For normal local setup and startup, follow
[Local Development Runtime](local-development.md). This guide covers Docker
Desktop, proxy, image-pull, and backend recovery issues only.

## Prerequisites

- Windows 10/11
- Docker Desktop
- Node.js 18+
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
`http://localhost:3000` for normal API and Git workflows.

Change the ESL Administrator Account password through ESL rather than editing
runtime storage: sign in to the Admin Console (`http://localhost:3000/admin`) as
the administrator account and change it under 平台设置 (Platform Settings). The
CLI does not host the platform administrator.
