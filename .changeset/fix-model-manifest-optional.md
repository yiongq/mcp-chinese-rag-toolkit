---
"@yiong/mcp-chinese-rag-toolkit": patch
---

Mark `special_tokens_map.json` as optional in model manifests. Some Hugging Face
model repos (e.g. certain reranker exports) ship without this file; the loader no
longer fails manifest verification when an entry flagged `optional: true` is
absent.
