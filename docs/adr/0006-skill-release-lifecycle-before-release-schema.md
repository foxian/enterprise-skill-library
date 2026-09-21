# Skill Release Lifecycle Before Release Schema

Status: accepted

ESL will first prove the user-facing Skill Release lifecycle through the
existing service model before introducing a dedicated release schema. A Skill
Release is the versioned artifact that Skill Users discover, install, update
to, and source, but the next implementation pass should focus on the
server-backed project install path: publish a release, install it as another
Skill User, publish a patch release, update the project install, and clone the
source through the ESL Server.

This avoids turning the lifecycle work into a broad data-model migration before
the product path is proven. Global installs, Local Skill Source updates, and
automatic adapt integration remain separate lifecycle concerns.
