# Single User-Facing Server URL

Status: accepted

ESL will expose a single user-facing server URL to CLI users and automation,
with API routes and Git HTTP access reachable through that entry point. The CLI
should use `--server` and store a `server` setting rather than `--registry` or
`gitBase`. API routes live under `/api`, Git HTTP routes live under `/git`, and
the CLI should not know Gitea-specific authentication details; login is owned by
`POST /api/auth/login`. API responses that require Git operations should return
full `cloneUrl` values so clients do not derive backend paths themselves. This
keeps Gitea as an internal backend while allowing the Docker runtime and
production deployments to use a reverse proxy for the shared external address.

The same Skill User Token authenticates both API and Git HTTP operations. Git
clone URLs remain clean and must not embed credentials; the CLI supplies the
token through Git HTTP authentication headers. The `/git` route may expose
Gitea's web UI as an internal or recovery path, but normal ESL documentation
should treat it as the Git HTTP backend path rather than a user-facing product
surface. Local Docker defaults should expose only the reverse-proxy server port;
debug overrides may expose Gitea directly.
