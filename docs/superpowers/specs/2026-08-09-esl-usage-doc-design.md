# Design Spec: ESL Usage Documentation (`USAGE.md`)

**Date:** 2026-08-09
**Status:** Approved

## Summary

Create a comprehensive end-to-end user guide in `USAGE.md` at the repository root covering both Skill Consumers and Skill Authors, authentication, configuration, and multi-agent directory mapping.

## Location

Root `USAGE.md`.

## Content Outline

1. **Overview & Key Concepts**
   - Skill Identity (`@namespace/skill-name`)
   - Draft Namespace (`@local/*`)
   - Canonical Store (`.skills/`) vs Agent Directories (`.claude/skills/`, `.trae/skills/`, `.agents/skills/`)
   - `.skills.json` and `.skills-lock.json`
2. **Environment & Authentication**
   - Docker Compose local runtime setup reference
   - `esl login` configuration
3. **Consumer Workflow**
   - `esl search <query>`
   - `esl info <skill-name>`
   - `esl install [name-or-path]` (with `--version`, `--global`, `--no-adapt`)
   - `esl list` / `esl ls` (with `--global`, `--json`)
   - `esl adapt` (with `--global`, `--directory`)
   - `esl update [skill-name]`
   - `esl uninstall <skill-name>`
4. **Author Workflow**
   - `esl init <skill-name>`
   - `esl validate [path]`
   - `esl publish`
   - `esl version <major|minor|patch>`
   - `esl source <skill-name> [target]`
5. **Multi-Agent Directory Mapping Reference**
   - Table of supported tools and output locations
