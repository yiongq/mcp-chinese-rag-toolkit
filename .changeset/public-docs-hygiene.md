---
"@yiong/mcp-chinese-rag-toolkit": patch
---

Docs hygiene: rewrite the README, source comments and generated API docs in
plain user-facing language. Strips internal development-process references
(story/epic numbers, requirement IDs, private downstream-package names, private
planning-doc paths) that have no meaning to external users of a public package,
and adds a `check-public-hygiene` CI gate that fails the build if such jargon is
reintroduced. Documentation-only — no API, type, or runtime behaviour change.
