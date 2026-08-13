Status: ready-for-agent

## Problem Statement

The ESL CLI works, but it ignores four decades of command-line conventions
captured in the Command Line Interface Guidelines at the repo root. It leaks
credentials (plaintext `--token`/`--password` flags, tokens embedded in Git
remote URLs, tokens stored in plaintext config), prints raw stack traces on
error, mixes human and machine-readable output, offers no confirmation before
destructive actions, and gives no feedback while long operations run. These
make it unsafe and hard to use by hand, and a poor citizen in scripts and CI.

## Solution

Bring the ESL CLI in line with the CLI Guidelines through a focused,
interface-defining hardening pass:

- **Secrets**: accept credentials only via a hidden prompt, a file, or stdin —
  never as plaintext flags — and store them in a dedicated credentials file
  readable only by the owner.
- **Output**: send data to stdout and human messaging to stderr; add `--json`
  to `info` and `search`; make `info` human-readable by default.
- **Errors**: route all failures through a single human-readable error path,
  showing stack traces only under a debug flag.
- **Interactivity**: confirm destructive actions, and provide `--force` and a
  global `--no-input` for scripted use.
- **Robustness**: print something before long operations, time out network
  requests, and exit promptly on Ctrl-C.
- **Help**: add examples to every command and source the reported version from
  the package manifest.

The `esl version` subcommand (skill version bump) stays as-is: it does not
conflict with `--version`, and matches the `npm version` convention.

## User Stories

1. As a skill user, I want to log in without typing my token as a plaintext
   command-line flag, so that it does not end up in shell history or process
   listings.
2. As a skill user, I want my password or token input hidden when I run
   interactively, so that someone over my shoulder cannot read it.
3. As a script author, I want to pass credentials via a file or stdin, so that
   I can authenticate non-interactively without exposing secrets.
4. As a skill user, I want my token stored in a dedicated credentials file
   readable only by me, so that other local users cannot read it.
5. As a skill user, I want non-sensitive configuration kept separate from my
   credentials, so that credentials never leak into shared or versioned config.
6. As a skill author, I want publishing not to embed my token in the Git remote
   URL, so that my token is not written into `.git/config`.
7. As a platform administrator, I want the Bootstrap Token protected the same
   way as a Skill User Token, so that platform-level credentials are not exposed.
8. As a maintainer, I want the ambiguous plaintext token flag removed, so that
   it is always clear whether a credential is a Bootstrap Token or a Skill User
   Token.
9. As a skill user, I want `esl info` to show a human-readable summary by
   default, so that I can read the essentials without parsing JSON.
10. As a script author, I want `esl info --json` to emit the full structured
    record, so that I can consume it programmatically.
11. As a script author, I want `esl search --json` to emit a structured result
    list, so that I can consume search results programmatically.
12. As a skill user, I want machine output on stdout and human messages on
    stderr, so that piping one command into another behaves predictably.
13. As a skill user, I want errors printed as a single human-readable line with
    a suggestion, so that I understand what to do next without reading a stack
    trace.
14. As a developer, I want a debug flag that reveals full stack traces on
    stderr, so that I can diagnose failures while keeping normal output clean.
15. As a script author, I want failures to exit with a non-zero code, so that
    my scripts can react to them.
16. As a skill user, I want `esl publish` to ask for confirmation before
    pushing to the registry, so that I do not publish by accident.
17. As a script author, I want `--force` to skip confirmation, so that I can
    publish or uninstall non-interactively.
18. As a script author, I want a global `--no-input` to disable all prompts, so
    that commands fail fast in automation instead of hanging.
19. As a skill user, I want prompts only when running in an interactive
    terminal, so that piped or scripted usage never blocks.
20. As a skill user, I want the CLI to print something immediately before a
    long operation, so that it does not appear hung.
21. As a skill user, I want network requests to time out after a sensible
    default, so that an unreachable server does not hang my terminal.
22. As an operator, I want to override the network timeout via an environment
    variable, so that I can tune it for slow networks.
23. As a skill user, I want Ctrl-C to stop the CLI immediately, so that I am
    not stuck waiting for cleanup.
24. As a skill user, I want each command's help to include one or two examples,
    so that I can learn usage by copying instead of reading prose.
25. As a skill user, I want `esl --version` to report the actual package
    version, so that I can trust the reported version.
26. As a maintainer, I want the reported version sourced from the package
    manifest rather than hardcoded, so that it cannot drift out of sync.

## Implementation Decisions

- Remove plaintext `--token` and `--password` flags everywhere. Accept
  credentials only via a hidden prompt, `--token-file`/`--password-file`, or
  stdin.
- Add a prompt helper (readline with echo disabled) as an injectable dependency
  on the command-execution seam, mirroring the existing `customFetch` injection
  pattern.
- Keep the login password-to-token exchange against the Git backend, but route
  it through the new credential input paths instead of plaintext flags.
- Move the token out of the general config object into a dedicated credentials
  file with owner-only (0600) permissions. Add dedicated load/save functions
  for credentials and keep non-sensitive config separate.
- Stop embedding tokens in Git remote URLs during publish. Push using an
  authorization header (`http.extraHeader`) so the token is not persisted in
  `.git/config`.
- Make `--token-file`/`--password-file`, the debug flag, and `--no-input`
  global options inherited by all subcommands for cross-command consistency.
- Add `--json` to `info` and `search`. Make `info` default to a human-readable
  summary showing the core fields (name, description, versions, Git repo path);
  `--json` emits the full existing data shape.
- Add a central error handler that prints one human-readable line plus a
  suggestion, emits stack traces to stderr only under the debug flag, and exits
  non-zero.
- Add `--force` to `publish` and `uninstall`, and confirmation to `publish`;
  honor `--no-input` by disabling every prompt.
- Add network timeouts (default 30 seconds, overridable via an environment
  variable) and print a status line before Git operations; exit promptly on
  SIGINT.
- Add one or two examples to each command's help text.
- Read the reported version from the package manifest instead of a hardcoded
  literal.
- Keep the `esl version` subcommand (skill version bump) unchanged.
- Record the Skill User Token versus Bootstrap Token distinction in the domain
  glossary (already captured in `CONTEXT.md`).

## Testing Decisions

- Test external behavior, not implementation details: assert user-visible
  output, exit codes, and side effects rather than internal helpers.
- Prefer the highest existing seam — the command-execution seam (the `execute*`
  functions with injected `customFetch`, `homeDir`, and `execFileAsync`).
- Add one new injected seam for prompt reading, at the same level as the
  existing `customFetch` injection.
- Use the program-registration seam (`createProgram`) to assert flag, option,
  help, and version wiring, following the existing bin test.
- Prior art: the existing command tests (login, commands, install) and the
  program-registration test (bin).
- Verify that tokens never appear in captured Git command arguments or in
  persisted non-credential config; the credentials file mode is 0600; `--json`
  emits the full record; errors are single-line without a stack unless the
  debug flag is set; prompts only fire on a TTY; `--no-input` and `--force`
  short-circuit; SIGINT exits promptly; and `--version` matches the manifest.

## Out of Scope

- `--plain` output flag
- `--dry-run`
- Progress bars and spinners
- Web-based documentation and tutorials
- Linking a web docs or issue URL in help text (no URL available yet)
- Renaming the `esl version` subcommand

## Further Notes

This is the first of two batches. It covers only the "now" work — changes that
define the interface, are cheap, and become hard to reverse once scripts depend
on them. Output-shape polish (`--plain`, `--dry-run`, progress indicators) is
deliberately deferred until the CLI's output surface stabilizes. The Command
Line Interface Guidelines document at the repo root is the source of truth for
the conventions applied here.
