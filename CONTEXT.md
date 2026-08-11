# Context

## Namespace

The stable namespace portion of a skill identity. In `@cnfox/code-review`, the
namespace is `cnfox`.

## Local Namespace

The reserved `local` namespace for skills that are local, unpublished, or not
yet assigned a stable publishing namespace.

## Local Skill Source

The original local directory where a skill is authored or maintained before it
is installed into a project skill store.

## Skill Identity

The full stable skill name in the form `@namespace/skill-name`.

## Adapted Skill Directory Name

The namespace-qualified directory name used for a skill in an AI tool's adapted
skill directory. It uses `namespace_skill-name`, such as `cnfox_code-review`, so
the namespace boundary remains unambiguous while staying within a single
tool-scanned directory level.

## Adapted Skill Display Name

The namespace-qualified name written into an adapted skill's `SKILL.md`
frontmatter for AI tools to display or identify the skill. It uses
`namespace:skill-name`, such as `cnfox:code-review`.

## Created By

The user who first created the skill. This is audit metadata, not the namespace
or current owner.

## Owner

The current business owner or platform owner of the skill.

## Maintainers

The users or teams allowed to maintain or publish the skill.
