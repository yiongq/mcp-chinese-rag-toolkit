---
"@yiong/mcp-chinese-rag-toolkit": patch
---

Fix BM25 keyword recall and harden the caption pipeline.

- **BM25 recall** — multi-token FTS5 queries are now joined with `OR` instead of
  being matched as a single quoted phrase, restoring keyword recall that an
  earlier phrase-match regression had silently narrowed.
- **Vision caption buffer** — each per-page `extractImages` call now receives its
  own `.slice()` of the PDF bytes, because `unpdf`/pdf.js detaches the input
  `ArrayBuffer` on each call; sharing it caused "detached ArrayBuffer" failures.
- **Network-error retry** — the shared caption engine now treats transient
  network errors (`ECONNRESET` and friends, including nested `cause` chains) as
  retryable, so captioning rides out flaky vision-provider connections.
