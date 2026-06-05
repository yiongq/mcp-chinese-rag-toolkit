# @yiong/mcp-chinese-rag-toolkit

## 0.2.0

### Minor Changes

- a08b181: Add the `withPageCaption` RAG plugin and a Streamable HTTP CORS whitelist.

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

### Patch Changes

- a08b181: CI: OIDC trusted publishing + provenance + size gate. Adds Changesets-driven
  versioning/CHANGELOG, a GitHub Actions `release.yml` using npm Trusted Publishing
  (OIDC, tokenless) with `provenance: true`, and a `npm pack` size guard (<100MB).
  Replaces the manual webauthn `npm publish` flow.
- a08b181: Mark `special_tokens_map.json` as optional in model manifests. Some Hugging Face
  model repos (e.g. certain reranker exports) ship without this file; the loader no
  longer fails manifest verification when an entry flagged `optional: true` is
  absent.
- a08b181: Fix BM25 keyword recall and harden the caption pipeline.

  - **BM25 recall** — multi-token FTS5 queries are now joined with `OR` instead of
    being matched as a single quoted phrase, restoring keyword recall that an
    earlier phrase-match regression had silently narrowed.
  - **Vision caption buffer** — each per-page `extractImages` call now receives its
    own `.slice()` of the PDF bytes, because `unpdf`/pdf.js detaches the input
    `ArrayBuffer` on each call; sharing it caused "detached ArrayBuffer" failures.
  - **Network-error retry** — the shared caption engine now treats transient
    network errors (`ECONNRESET` and friends, including nested `cause` chains) as
    retryable, so captioning rides out flaky vision-provider connections.

## 0.1.0 — 2026-05-23

Initial public release. Extracted from an upstream monorepo as a
standalone package; full commit history preserved via
`git filter-repo --subdirectory-filter`.

What's in this release:

- MCP server factory (`createMcpServer`) with stdio + Streamable HTTP transports
- Tool builder (`defineTool`) + resource provider (`defineResources`) with shape validation
- Structured error envelope (`errors.create`, `ErrorCodeSchema`)
- Chinese RAG pipeline:
  - PDF parser + hierarchical chunker (`parsePdf`, `chunk`, `chunkPdfPages`)
  - jieba FTS5 tokenizer (`tokenize`)
  - BGE-large-zh-v1.5 embedder with hash verification (`loadEmbedder`)
  - sqlite-vec storage (`openIndex`)
  - Hybrid search with RRF fusion (`createHybridSearch`, `rrfFuse`)
  - BGE-reranker-v2-m3 reranker with stdio P95 latency harness (`createReranker`, `runStdioLatencyHarness`)
  - LRU caption cache for vision plugin (`openCaptionCache`, `withVisionCaption`)
  - Contextual retrieval prompt + LRU cache (`generateChunkContext`, `withLruCache`)
- Eval framework: Hit Rate@K / MRR runner + GitHub Actions annotations (`runEval`, `passesGate`, `emitGitHubActionsAnnotation`)
- `create-mcp-rag` scaffolder CLI (templates/create-mcp-rag/)
- Native cache defaults: `<userCacheDir>/mcp-chinese-rag-toolkit/{models,caption-cache}/`
- TypeScript strict + ESM/CJS dual + `.d.ts`/`.d.cts`

Future versions: see [GitHub Releases](https://github.com/yiongq/mcp-chinese-rag-toolkit/releases).
