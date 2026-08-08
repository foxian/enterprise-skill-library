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
