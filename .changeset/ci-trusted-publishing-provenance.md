---
"@yiong/mcp-chinese-rag-toolkit": patch
---

CI: OIDC trusted publishing + provenance + size gate. Adds Changesets-driven
versioning/CHANGELOG, a GitHub Actions `release.yml` using npm Trusted Publishing
(OIDC, tokenless) with `provenance: true`, and a `npm pack` size guard (<100MB).
Replaces the manual webauthn `npm publish` flow.
