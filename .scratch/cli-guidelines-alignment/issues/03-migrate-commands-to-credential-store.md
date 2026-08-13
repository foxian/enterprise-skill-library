# 03 — Migrate commands to the credential store (contract)

**What to build:** Every command that talks to the registry or Git backend reads
its token from the dedicated credentials file instead of the general config.
All remaining plaintext `--token` and `--password` flags are removed, and the
token field disappears from the general config object. This is the "contract"
step that finishes the credentials migration.

**Blocked by:** 02 — Login without plaintext flags.

**Status:** ready-for-agent

- [ ] Every network command reads the token from the credentials file instead
  of the general config.
- [ ] No command accepts `--token` or `--password` plaintext flags.
- [ ] The token field is removed from the general config object.
- [ ] Credentials never appear in the general config file.

