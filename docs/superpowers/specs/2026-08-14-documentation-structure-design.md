# Documentation Structure Design

- Status: Approved
- Date: 2026-08-14

## Goal

Make the repository documentation easy to enter, navigate, and maintain by
separating current project guidance, Superpowers workflow records, external
reference material, and architecture or product decisions.

## Documentation Ownership

### Repository Entry Point

Create a root `README.md` as the public repository entry point. It will provide
the product description, a short local quick start, and links to the current
guides, decision records, and contribution instructions. It will not duplicate
the complete command reference or Docker troubleshooting details.

### Current Guides

Move active, task-oriented documents into `docs/guides/`:

- `USAGE.md` to `docs/guides/usage.md`: ESL CLI user and skill author guide.
- `docs/local-dev.md` to `docs/guides/local-development.md`: normal local
  development and Docker runtime workflow.
- `DOCKER_SETUP.md` to `docs/guides/docker-troubleshooting.md`: Docker Desktop,
  registry proxy, image pull, and runtime diagnosis reference.

`local-development.md` is the authoritative setup path. The Docker
troubleshooting guide links back to it and does not repeat the normal startup
or CLI workflow.

### Superpowers Records

Keep all design specifications and implementation plans produced or maintained
by the Superpowers workflow under `docs/superpowers/`:

- Move every file in `docs/specs/` into `docs/superpowers/specs/`.
- Move every file in `docs/plans/` into `docs/superpowers/plans/`.

Existing files already under these directories remain where they are. The
migration preserves filenames and git history through `git mv`.

### Decisions and References

- Keep architectural decisions in `docs/adr/`.
- Keep product and policy decisions in `docs/decisions/`.
- Move the external CLI Guidelines copy to
  `docs/reference/command-line-interface-guidelines.md`.
- Retain `CONTEXT.md` at the repository root because it is the canonical domain
  vocabulary referenced by agent instructions.

## Navigation and Links

The README will provide the primary navigation. Each active guide will link to
the adjacent guide only when needed:

- Usage guide links to local development only for users running ESL locally.
- Local development links to Docker troubleshooting for build, network, or
  Docker Desktop failures.
- Docker troubleshooting links back to local development for the ordinary
  startup path.

Update repository references, including `AGENTS.md`, so no instructions point
to the old root or pre-migration `docs/specs/` and `docs/plans/` paths.

## Non-Goals

- Do not move `.scratch/`; it remains the local Markdown issue tracker and
  active-work workspace.
- Do not change the behavior, CLI contract, Docker Compose configuration, or
  server implementation.
- Do not remove decision history or Superpowers records.

## Verification

Verify the migration with:

```powershell
rg -n "USAGE\.md|DOCKER_SETUP\.md|docs/(specs|plans)/" --glob "*.md" .
git status --short
```

Review the README and all three guides for duplicated setup instructions and
broken relative links. Documentation-only changes do not require `npm test` or
`npm run build`.
