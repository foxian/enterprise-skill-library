# ADR: Adopt Enterprise Skill Library as the Public Project Name

- Status: Accepted
- Date: 2026-08-08

## Context

The project is an enterprise internal platform for sharing AI Agent skills.
Enterprise Skill Library (ESL) is already used by the CLI, package names,
configuration, repository paths, and developer documentation.

The project's primary value is skill sharing between people and teams. It is
not positioned first as a compliance, governance, or administration system.

## Decision

Use **Enterprise Skill Library** as the public project and product name for the
Git-hosted project. Use **ESL** as the abbreviation.

Keep the existing technical identity:

- Project and architecture name: Enterprise Skill Library (ESL)
- CLI name: `esl`
- Package scope: `@esl/*`
- Repository and configuration identifiers: unchanged unless a later migration
  is explicitly approved

Use the following short description in product-facing copy:

> Enterprise Skill Library is an enterprise platform for discovering, sharing,
> and using AI Agent skills across teams.

## Alternatives Considered

### Keep ESL as the only public name

Rejected as the primary public name. The abbreviation is useful for the CLI and
technical references, but the expanded name is clearer for Git-hosted discovery.

### Use Sage as the public brand

Rejected as a standalone name. It is too broad for the product and requires
additional explanation.

### Use Sage Skills Hub

Reserved as a possible name for a future user-facing portal or marketplace
surface. It is more specific than necessary for the public project name today.

## Consequences

Positive:

- Product-facing language is easier to understand than the abbreviation alone.
- Existing source compatibility is preserved.
- Git-hosted discovery benefits from clear keywords: enterprise, skill, and
  library.

Trade-offs:

- Documentation must distinguish public project naming from technical package
  naming.
- Some older exploratory documentation may need a gradual terminology update.

## Naming Rules

- Use **Enterprise Skill Library** in public docs, README text, demos, and
  launch materials.
- Use **ESL** in architecture, package, API, repository, and migration contexts.
- Do not rename the `esl` CLI or `@esl/*` packages as part of naming work alone.
