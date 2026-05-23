# @yiong/mcp-chinese-rag-toolkit

## 0.1.0 — 2026-05-23

Initial public release. Standalone repo split out from the
upstream-ai-edge monorepo (commit history preserved via
`git filter-repo --subdirectory-filter`).

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
