# Derived from Anthropic's skill-creator (Apache-2.0); modified for skill-forge. See LICENSE.txt.
"""Shared utilities for skill-forge scripts."""

import os
import shlex
from pathlib import Path


# Built-in headless backend: Claude Code's CLI. Trigger-event detection
# (run_eval.py) speaks its stream-json protocol; other backends only work
# for plain prompt-in/text-out calls unless they mimic that protocol.
DEFAULT_TEXT_CLI = "claude -p --output-format text"
DEFAULT_STREAM_CLI = "claude -p --output-format stream-json --verbose --include-partial-messages"


def agent_cli_command(
    model: str | None = None,
    *,
    stream_json: bool = False,
    prompt: str | None = None,
) -> list[str]:
    """Resolve the headless agent CLI command as an argv list.

    Honors the SKILL_AGENT_CLI environment variable (a full command string,
    e.g. "my-cli run --quiet"); falls back to Claude Code's `claude -p`.
    The --model flag is only appended for the built-in default, since other
    CLIs use different flags — bake model selection into SKILL_AGENT_CLI
    when using a custom backend.

    When prompt is given, it is placed as `claude -p <prompt>` for the
    default backend. For a custom command, use the "{prompt}" placeholder
    to choose its position; otherwise the prompt is appended at the end.
    """
    custom = os.environ.get("SKILL_AGENT_CLI", "").strip()
    if custom:
        cmd = shlex.split(custom)
        if prompt is not None:
            if "{prompt}" in cmd:
                cmd = [prompt if token == "{prompt}" else token for token in cmd]
            else:
                cmd.append(prompt)
        return cmd

    cmd = shlex.split(DEFAULT_STREAM_CLI if stream_json else DEFAULT_TEXT_CLI)
    if prompt is not None:
        cmd.insert(2, prompt)  # claude -p <prompt> [options]
    if model:
        cmd.extend(["--model", model])
    return cmd


def agent_subprocess_env() -> dict[str, str]:
    """Environment for a headless agent CLI spawned from inside a session.

    Removes the interactive-session guard variable so the host tool's own
    headless CLI can be nested as a subprocess (programmatic usage is safe;
    the guard only exists to avoid interactive terminal conflicts).
    """
    return {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}



def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Parse a SKILL.md file, returning (name, description, full_content)."""
    content = (skill_path / "SKILL.md").read_text()
    lines = content.split("\n")

    if lines[0].strip() != "---":
        raise ValueError("SKILL.md missing frontmatter (no opening ---)")

    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        raise ValueError("SKILL.md missing frontmatter (no closing ---)")

    name = ""
    description = ""
    frontmatter_lines = lines[1:end_idx]
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("name:"):
            name = line[len("name:"):].strip().strip('"').strip("'")
        elif line.startswith("description:"):
            value = line[len("description:"):].strip()
            # Handle YAML multiline indicators (>, |, >-, |-)
            if value in (">", "|", ">-", "|-"):
                continuation_lines: list[str] = []
                i += 1
                while i < len(frontmatter_lines) and (frontmatter_lines[i].startswith("  ") or frontmatter_lines[i].startswith("\t")):
                    continuation_lines.append(frontmatter_lines[i].strip())
                    i += 1
                description = " ".join(continuation_lines)
                continue
            else:
                description = value.strip('"').strip("'")
        i += 1

    return name, description, content
