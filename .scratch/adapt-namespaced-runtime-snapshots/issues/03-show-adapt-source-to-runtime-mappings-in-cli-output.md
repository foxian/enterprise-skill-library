# 03 — Show adapt source-to-runtime mappings in CLI output

**What to build:** CLI adapt output should make the generated runtime mapping visible to users. Instead of reporting only short skill names, adapt output should show each Skill Identity mapped to its Adapted Skill Directory Name, such as `@cnfox/code-review -> cnfox_code-review`.

**Blocked by:** 01 — Adapt project skills with namespaced runtime identity; 02 — Adapt global skills with namespaced runtime identity.

**Status:** ready-for-agent

- [ ] Project adapt CLI output displays each `@namespace/skill-name -> namespace_skill-name` mapping.
- [ ] Global adapt CLI output displays the same kind of mapping.
- [ ] CLI output remains concise and readable when multiple skills are adapted.
- [ ] CLI parsing, output, and exit behavior remain in the CLI package.
