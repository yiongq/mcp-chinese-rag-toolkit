# @yiong/mcp-chinese-rag-toolkit

> Reusable MCP server factory + Chinese RAG pipeline + eval framework for building production MCP servers in TypeScript.

🚧 **0.1.x — server factory + tool / resource builders.** RAG pipeline lands in Epic 2.

## Install

```bash
pnpm add @yiong/mcp-chinese-rag-toolkit
```

Requires Node.js `>=20.0.0`. Ships ESM + CJS + `.d.ts` / `.d.cts` so both `import` and `require` consumers (and TypeScript strict mode) resolve without dual-module hazard.

## Quick start

### stdio server (CLI / Claude Desktop / VS Code clients)

```ts
import { createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const server = createMcpServer({
  name: 'my-mcp', version: '0.1.0', transport: 'stdio',
  tools: [{
    name: 'ping',
    description: 'Reply with pong.',
    inputSchema: z.object({}),
    handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  }],
});
await server.start();
```

### Streamable HTTP server (remote MCP clients, stateless)

```ts
import { createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const server = createMcpServer({
  name: 'my-mcp', version: '0.1.0', transport: 'http', port: 3000,
  tools: [{
    name: 'echo',
    description: 'Echo the message.',
    inputSchema: z.object({ message: z.string() }),
    handler: async (args) => {
      const { message } = args as { message: string };
      return { content: [{ type: 'text', text: message }] };
    },
  }],
});
await server.start();
// POST http://127.0.0.1:3000/mcp
```

### Error envelope

```ts
import { errors } from '@yiong/mcp-chinese-rag-toolkit';

return errors.create('ENTITY_NOT_FOUND', 'No matching record', {
  retryable: false,
  confidence: 'low',
  citations: [{ source: 'handbook.pdf', page: 12 }],
  refusal: 'No high-confidence answer available.',
});
```

The factory automatically wraps any thrown handler exception into an `INTERNAL_ERROR` envelope (architecture rule #5), so handlers never leak uncaught errors. Error codes are enforced `SCREAMING_SNAKE_CASE`; `retryable` defaults to `false` (fail-closed, NFR15).

`MCP_TRANSPORT=stdio|http` env var is read when `config.transport` is omitted (default: `stdio`). Illegal values fail fast — no silent fallback.

## MCP Inspector smoke test

For an end-to-end protocol validation (Resources / Tools / Prompts primitives), run:

```bash
pnpm --filter @yiong/mcp-chinese-rag-toolkit exec \
  npx @modelcontextprotocol/inspector \
  pnpm --filter @yiong/mcp-chinese-rag-toolkit exec tsx scripts/inspector-smoke.ts
```

Then open the Inspector UI and verify all three tabs report ✅:

```
Resources: 0 ✓ / Tools: 1 (echo_tool) ✓ / Prompts: 0 ✓
```

## Tool Builder & Resource Provider

The `defineTool` / `defineResources` helpers enforce naming conventions (snake_case tool names,
camelCase parameter keys, `{scheme}://{kind}/{id}` resource URIs) at **build time**, and
`withHooks` reserves an opt-in instrumentation seam for Phase 2 OpenTelemetry without touching
business code.

### `defineTool` — author-friendly + LLM-aware

```ts
import { defineTool, createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';
import { z } from 'zod';

const echoTool = defineTool({
  name: 'echo_tool', // snake_case (build-time enforced)
  description: 'Echo the input message back to the caller.',
  whenToUse: 'For toolkit smoke testing only — verifies transport + factory wiring end-to-end.',
  examples: [
    { description: 'simple echo', input: { message: 'hello' } },
  ],
  inputSchema: z.object({
    message: z.string(), // camelCase (build-time enforced)
  }),
  handler: async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
});

const server = createMcpServer({
  name: 'demo', version: '0.1.0', tools: [echoTool],
});
```

`description + whenToUse + examples` are composed into a single rich LLM-facing string and
capped at 2048 chars to keep the model's tool-selection context light. Bad names / bad
parameter keys / missing `whenToUse` / oversized descriptions throw at `defineTool` call
time — no surprises at runtime.

### `defineResources` — typed list / read with URI guardrails

```ts
import { defineResources, createMcpServer } from '@yiong/mcp-chinese-rag-toolkit';

const hrDocs = defineResources({
  uriScheme: 'hr', // ^[a-z][a-z0-9-]*$ (kebab/lower, build-time enforced)
  title: 'HR Documents',
  mimeType: 'text/markdown',
  list: async () => ({
    resources: [
      { uri: 'hr://page/23', name: 'Page 23' }, // {scheme}://{kind}/{id} — enforced
      { uri: 'hr://page/24', name: 'Page 24' },
    ],
  }),
  read: async (uri, { kind, id }) => ({
    contents: [{ uri: uri.href, text: `<page ${kind}/${id} content>`, mimeType: 'text/markdown' }],
  }),
});

const server = createMcpServer({
  name: 'hr', version: '0.1.0', resources: [hrDocs],
});
```

`createMcpServer` registers the resource via the MCP SDK's `ResourceTemplate` and fails fast
on duplicate `uriScheme` entries. Any `list()` entry or `read()` call whose URI breaks the
`{scheme}://{kind}/{id}` pattern throws before reaching the wire.

### `withHooks` — opt-in observability seam (Phase 2 OTel pattern)

```ts
// Phase 2 pattern — pseudo-code, no runtime OTel dependency in this package.
import { defineTool, withHooks } from '@yiong/mcp-chinese-rag-toolkit';

const tool = defineTool({ /* ...as above... */ });
tool.handler = withHooks(
  tool.handler,
  {
    before: ({ toolName, args }) => span.start(toolName, { args }),
    after: ({ result, durationMs }) => span.end({ status: 'ok', durationMs }),
    error: ({ err, durationMs }) => span.recordException(err, { durationMs }),
  },
  { toolName: tool.name },
);
```

Invariants you can rely on:

- The original error is **re-thrown** — `createMcpServer` still owns conversion to the
  `INTERNAL_ERROR` envelope (no double-wrap, no lost stack trace).
- Hook failures are **swallowed** and logged via `console.warn`; business results never
  break because an observability hook misbehaved.
- `durationMs` uses `performance.now()` for high-precision, clock-jump-immune timing.

## Roadmap

| Phase | Story / Epic | Surface added |
| --- | --- | --- |
| ✅ Server factory + error envelope | Story 1.3 | `createMcpServer`, `errors` helpers |
| ✅ Tool builder + Resource provider + instrumentation hooks | Story 1.4 | `defineTool`, `defineResources`, `withHooks` |
| ADR + naming conventions migration | Story 1.5 | docs alignment, no API change |
| Chinese RAG pipeline (parser → chunk → embed → BM25 + vec + RRF + rerank) | Epic 2 (Stories 2.1–2.7) | `rag/*` exports + eval CI gate |
| Vision caption plugin | Epic 2 Story 2.8 | `rag/vision-caption` |
| `create-mcp-rag` CLI + Documentation Set (FR49) | Epic 2 Story 2.9 | `bin/create-mcp-rag`, README/CHANGELOG/templates |

See the umbrella roadmap in the repo root [`README.md`](../../README.md) for cross-package status.

## RAG primitives (Story 2.1+)

The first slice of the Chinese RAG pipeline lands as pure primitives — PDF
text extraction and Markdown-aware chunking. They are the data-shape source
of truth (`Chunk` / `ChunkOptions` / `ParsePdfResult` / `PdfPage`) consumed
by every subsequent indexing / retrieval layer. The higher-level
`ChineseRagPipeline` (jieba + FTS5 + sqlite-vec + RRF + reranker) lands in
Stories 2.2 → 2.6.

### `parsePdf` — PDF → per-page text (unpdf-based)

```ts
import { parsePdf } from '@yiong/mcp-chinese-rag-toolkit';

const { totalPages, pages } = await parsePdf('hr.pdf');
//                                            ^ string path | Uint8Array | ArrayBuffer
console.log(pages[0]?.pageNumber); // 1 — 1-indexed, matches Citation.page
console.log(pages[0]?.text);
```

`parsePdf` does NOT swallow underlying errors (corrupt PDF, missing file,
encrypted input). Callers wrap them into MCP envelopes via `errors.create`
when needed.

### `chunk` — Markdown hierarchical chunker

```ts
import { chunk } from '@yiong/mcp-chinese-rag-toolkit';

const chunks = await chunk(markdownText, {
  chunkSize: 1000,        // characters; default 1000, range [100, 4000]
  chunkOverlap: 200,      // characters; default 200, range [0, chunkSize)
  source: 'handbook.md',
});

chunks[0]?.section; // e.g. "第一章 入职流程 > 1.1 试用期" — H1..H4 path
```

Markdown headings up to four levels are tracked into `chunk.section`
(joined by ` > `). Chunks never span across a heading boundary; pure
text input leaves `section` undefined.

### `chunkPdfPages` — PDF → `Chunk[]` end-to-end

```ts
import { parsePdf, chunkPdfPages } from '@yiong/mcp-chinese-rag-toolkit';

const { pages } = await parsePdf('hr.pdf');
const chunks = await chunkPdfPages(pages, { source: 'hr.pdf' });
// every chunk carries source + page; blank pages are skipped.
```

Indexing (jieba tokenizer + FTS5 + `bge-large-zh-v1.5` embedder + `vec0`)
arrives in Story 2.2; hybrid search and reranking follow in Stories 2.4–2.5.

## RAG storage layer (Story 2.2+)

The toolkit now ships an opinionated SQLite + `sqlite-vec` + jieba storage
layer that turns `Chunk[]` (from `chunkPdfPages` / `chunk`) into a single
`.db` file with three tables: `docs` (content + provenance), `docs_fts`
(FTS5 BM25 over jieba-pretokenized text) and `docs_vec` (`vec0` virtual
table holding the per-chunk embedding). Hybrid Search + RRF land in
Story 2.4 — this section is the storage substrate they sit on.

### `openIndex` — open / create an index handle

```ts
import { openIndex } from '@yiong/mcp-chinese-rag-toolkit';

const handle = openIndex('data/hr-index.db', { embeddingDim: 1024 });
try {
  console.log(handle.getIndexVersion()); // → 'v1-…' (Story 2.6 cache key)
} finally {
  handle.close();
}
```

Pass `{ readonly: true }` to open a prebuilt `.db` (e.g. one shipped
inside an mcp-hr npm tarball) without re-running the schema.

### `indexChunks` — three-table transactional write

```ts
import { openIndex, parsePdf, chunkPdfPages } from '@yiong/mcp-chinese-rag-toolkit';

const handle = openIndex('data/hr-index.db');
const { pages } = await parsePdf('hr.pdf');
const chunks = await chunkPdfPages(pages, { source: 'hr.pdf' });
// `embedding` is a Float32Array of length `embeddingDim` (default 1024,
// matching bge-large-zh-v1.5 — Story 2.3 will provide the embedder).
handle.indexChunks(chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i] })));
handle.close();
```

Dimension mismatches fail fast and roll back the entire batch (single
`better-sqlite3` transaction — 50–100× faster than per-row autocommit).

### `ftsSearch` — BM25 over jieba-pretokenized text

```ts
const hits = handle.ftsSearch('请假流程', { topK: 30 });
hits[0]?.bm25Rank; // 1-indexed, ready for Story 2.4 RRF fusion
```

### `vecSearch` — sqlite-vec KNN

```ts
const hits = handle.vecSearch(queryEmbedding, { topK: 30 });
hits[0]?.distance; // sqlite-vec L2 distance (Story 2.3 may opt into cosine)
```

### `tokenize` — standalone jieba pre-tokenization

```ts
import { tokenize } from '@yiong/mcp-chinese-rag-toolkit';
tokenize('试用期管理规定'); // → '试用期 管理 规定'
```

Exposed as a top-level helper so business code can reuse the same
tokenizer for query expansion / synonym lookup, not just indexing.

Story 2.3 will land the `bge-large-zh-v1.5` embedder so `indexChunks`
can be driven from `chunk.content` end-to-end without external glue.

## Embedder (Story 2.3+)

This section is the **semantic layer** of the Chinese RAG indexing
pipeline. It exposes `loadEmbedder()` (returns an `Embedder` whose
`embed` / `embedBatch` produce 1024-dim L2-normalized vectors via
`@huggingface/transformers` + `Xenova/bge-large-zh-v1.5`) and the
supply-chain guardrails (`verifyModelFiles` + a pinned
`BGE_LARGE_ZH_V1_5_MANIFEST`). Hybrid Search + RRF that consume these
vectors land in Story 2.4.

### `loadEmbedder` — bge-large-zh-v1.5 (1024-dim, CLS pooling, L2-normalized)

```ts
import { loadEmbedder, openIndex, writeEmbedderMeta } from '@yiong/mcp-chinese-rag-toolkit';

const embedder = await loadEmbedder(); // default cacheDir = <userCacheDir>/mcp-chinese-rag-toolkit/models
const handle = openIndex(':memory:', { embeddingDim: 1024 });
writeEmbedderMeta(handle.db, embedder); // → meta.embedding_model = 'Xenova/bge-large-zh-v1.5'

const query = await embedder.embed('试用期多久'); // Float32Array(1024)
const batch = await embedder.embedBatch(['请假流程', '加班政策'], { batchSize: 32 });
```

`loadEmbedder` caches the underlying pipeline as a process-level singleton
keyed by the manifest content hash, cache dir, and load options
(`verifyHashes` / `allowRemoteModels`), so subsequent calls with the same
configuration return in <5 ms. Failed loads are evicted from the cache, so a
re-run after fixing a tampered file just works.

### `verifyModelFiles` + `ModelHashMismatchError` — supply-chain attestation

```ts
import {
  BGE_LARGE_ZH_V1_5_MANIFEST,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from '@yiong/mcp-chinese-rag-toolkit';

try {
  await verifyModelFiles(resolveCacheDir(), BGE_LARGE_ZH_V1_5_MANIFEST, { strict: true });
} catch (err) {
  if (err instanceof ModelHashMismatchError) {
    // CI / ops can run this as an independent attestation step before serving traffic.
  }
}
```

`loadEmbedder` runs the same verification twice automatically (pre-load
opportunistic + post-load strict). The standalone export exists so
operators can attest a pre-baked cache directory without instantiating
the pipeline. Catch with `err instanceof ModelHashMismatchError` OR
`err.name === 'ModelHashMismatchError'` — the latter survives the
ESM/CJS boundary should both copies of the package coexist.

### `BGE_LARGE_ZH_V1_5_MANIFEST` — pinned SHA-256 + byte size

The manifest is hardcoded; never fetched at runtime. To bump it for a
new upstream revision: run `pnpm manifest:fetch` (dev tool), paste the
output into `src/rag/model-manifest.ts`, run Story 2.7 eval to confirm
no Hit Rate@5 regression, then ship as a toolkit minor bump.

Story 2.4 will provide the hybrid search that fuses `embed(query)` with
`ftsSearch` via Reciprocal Rank Fusion — wiring the embedder above into
the storage layer end-to-end.

## License

MIT (LICENSE file lands in Story 1.5 alongside the ADR migration).
