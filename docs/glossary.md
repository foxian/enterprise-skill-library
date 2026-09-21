# Glossary

## Enterprise Skill Library

The public project and product name for the enterprise platform that lets teams
discover, share, and use AI Agent skills.

## ESL

Short for Enterprise Skill Library, including the CLI, packages, APIs,
repository identifiers, and storage conventions.

## Skill

A reusable package of instructions, references, scripts, and assets that gives
an AI Agent a specialized capability or workflow.

## Namespace

The namespace portion of a skill name. In `@cnfox/code-review`, the namespace
is `cnfox`. The namespace is part of the skill's stable identity and is used in
local paths, dependency keys, lockfiles, adapter output, and platform repository
paths.

## Local Namespace

The reserved `@local` namespace for skills that are local, unpublished, or not
yet assigned a stable publishing namespace. `@local/*` skills are local-only
by default and should be renamed before publishing.

## Skill Sharing

The core product workflow: a person or team publishes a skill so other
authorized users and teams can discover, install, adapt, and use it.

## Skill Adapter

A tool-specific transformation that copies or formats a skill for an AI Agent
environment such as Claude, Codex, TRAE, or TRAE CN.

## Logical Team

ESL 层的自定义团队，只表示一组组织成员，不携带固定技能权限。逻辑团队可以在
不同技能上分别获得 Read、Write 或 Manage 授权。

## Skill Team Grant

针对单个技能授予逻辑团队的权限档位。同一技能、同一逻辑团队最多有一个档位，
不同技能之间互不影响。

## Backend Permission Team

Git Backend 中由逻辑团队投影出的内部团队，分别对应 Read、Write 和 Manage。它们
是实现细节，不作为 ESL 用户可见的自定义团队。
