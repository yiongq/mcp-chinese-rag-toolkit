---
"@yiong/mcp-chinese-rag-toolkit": minor
---

Add the `withPageCaption` RAG plugin and a Streamable HTTP CORS whitelist.

- **`withPageCaption`** — a new page-level multimodal captioning plugin
  (`PageCaptionOptions`) that renders each PDF page and captions it through a
  pluggable vision provider. It shares a single `caption-engine` with
  `withVisionCaption`, so the retry/backoff policy has one source of truth.
  Exported from the package root.
- **Streamable HTTP CORS whitelist** — `createMcpServer` now accepts a `cors`
  option with an `origins` whitelist (exact origin or `scheme://*` wildcard).
  Matched origins are echoed back, `OPTIONS` preflight is answered, and no
  `Access-Control-*` headers are emitted when the option is omitted. This lets
  browser MCP clients (e.g. a Chrome extension) connect over HTTP.
