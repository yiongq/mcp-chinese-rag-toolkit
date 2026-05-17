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

## Hybrid Search (Story 2.4+)

The retrieval layer composes the Story 2.2 storage primitives and the
Story 2.3 embedder into a single fused query: BM25 (`ftsSearch`) and
vector KNN (`vecSearch`) run in parallel, and Reciprocal Rank Fusion
(Cormack et al. 2009) merges the two ranked lists without normalizing
their disparate score scales. Story 2.5 adds the
`bge-reranker-v2-m3` cross-encoder on top of the hybrid top-K; Story 2.6
adds the LRU cache around the whole pipeline.

### `createHybridSearch` — BM25 + vec fused via RRF

```ts
import {
  createHybridSearch,
  loadEmbedder,
  openIndex,
  writeEmbedderMeta,
  writeTokenizerMeta,
} from '@yiong/mcp-chinese-rag-toolkit';

const embedder = await loadEmbedder();
const handle = openIndex('index.db', { embeddingDim: embedder.dim });
writeEmbedderMeta(handle.db, embedder); // → meta.embedding_model
writeTokenizerMeta(handle.db); // → meta.tokenizer_version = '@node-rs/jieba@2.0.1'

// (mcp-hr / mcp-modeling build-index.ts owns the chunk → embedding → indexChunks loop.)

const search = createHybridSearch({ handle, embedder });
const hits = await search('试用期管理规定', { topK: 5 });
// hits[0]?.rrfScore  → ~0.03 (both BM25 and vec hit)
// hits[0]?.bm25Rank  → 1
// hits[0]?.vecRank   → 1 or 2
// hits[0]?.chunk.content → '试用期管理覆盖入职三个月内的所有同事…'
```

Defaults: `perSourceTopK = 30` (each side before fusion), `topK = 10`
(final fused cap), `rrfK = 60`. Pass `defaultOpts` to the factory to
share opts across calls, or override per-call. All three options accept
positive integers in `[1, 1000]` — out-of-range / non-integer / empty
query inputs throw fail-fast `Error('hybridSearch: …')`. Errors from
`embedder.embed` / `handle.ftsSearch` / `handle.vecSearch` propagate to
the caller unmodified; `wrapHandler` (server layer) is the canonical
spot to convert them into MCP error envelopes.

### `rrfFuse` — pure rank-fusion helper

```ts
import { rrfFuse } from '@yiong/mcp-chinese-rag-toolkit';

const bm25 = [{ id: 1, rank: 1, payload: 'a' }, { id: 2, rank: 2, payload: 'b' }];
const vec = [{ id: 2, rank: 1, payload: 'B' }, { id: 3, rank: 2, payload: 'C' }];
const fused = rrfFuse([bm25, vec], { k: 60 });
// fused[0] → { id: 2, score: 1/61 + 1/62, ranks: [2, 1], payloads: ['b', 'B'] }
```

`rrfFuse` is the same fusion `createHybridSearch` uses internally —
exposed standalone so the Story 2.5 reranker can fuse its own third
ranked list (`rrfFuse([fts, vec, rerank], { k: 60 })`) and so third-party
toolkit consumers can test alternative fusion strategies against the RRF
baseline.

### `writeTokenizerMeta` + `JIEBA_VERSION` — pin the active jieba release

```ts
import { JIEBA_VERSION, writeTokenizerMeta } from '@yiong/mcp-chinese-rag-toolkit';

writeTokenizerMeta(handle.db); // defaults to JIEBA_VERSION ('@node-rs/jieba@2.0.1')
// SELECT value FROM meta WHERE key = 'tokenizer_version' → '@node-rs/jieba@2.0.1'
```

Symmetric to `writeEmbedderMeta`: call once during indexing to pin the
jieba release into the on-disk index. Story 2.6's cache key and any
future jieba-dictionary upgrade trigger a reindex decision based on this
field; upgrading the dep without bumping `JIEBA_VERSION` is a
correctness bug.

## Reranker (Story 2.5+)

The reranker stage is the *last* stop in the RAG retrieval pipeline
(`hybrid → rerank → optional LRU cache`). It runs the
`bge-reranker-v2-m3` cross-encoder over `(query, chunk.content)` pairs
to produce a sigmoid-of-logit relevance score in `[0, 1]` and trims the
hybrid top-10 down to the canonical top-5 envelope used by
`mcp-hr.search_hr_docs` and `mcp-modeling.*`. The Story 2.6 LRU cache,
when it lands, wraps the entire `hybrid + rerank` pipeline as a single
`withLruCache` middleware — the reranker is intentionally a separate
factory so callers can skip it (ablation eval) or share its cache.

This section is also the home of NFR1 (`stdio P95 < 200ms`): the
`runStdioLatencyHarness` + `bin/latency-harness.ts` + `bench/baseline.json`
trio enforces the P95 contract on every PR.

### `loadReranker` + `Reranker.rank`

```ts
import { loadReranker } from '@yiong/mcp-chinese-rag-toolkit';

const reranker = await loadReranker();
const scores = await reranker.rank('试用期', [
  '试用期管理覆盖入职三个月内的所有同事。',
  '加班补偿可换算调休。',
  '请假流程通过 OA 提交。',
]);
// scores[0]?.score → ~0.95 (exact relevance — cross-encoder is much
//                            sharper than the bi-encoder embedder)
// scores[1]?.score → ~0.05
```

`loadReranker(opts?)` returns a process-wide singleton keyed by
`(manifestFingerprint, cacheDir, verifyHashes, allowRemoteModels)` —
mirroring `loadEmbedder`. The default manifest pins
`onnx-community/bge-reranker-v2-m3-ONNX` at `dtype: 'q8'` (570MB
single-file ONNX; see manifest JSDoc for the trade-off rationale).
`rank(query, documents, opts?)` clamps `batchSize` to `[1, 64]` and
`maxLength` to `[16, 512]`; `documents` order is preserved in the
result so callers can re-attach their own metadata via the
`RankedDocument.index` field.

### `createReranker` + `RerankedHit`

```ts
import {
  createHybridSearch,
  createReranker,
  loadEmbedder,
  loadReranker,
  openIndex,
} from '@yiong/mcp-chinese-rag-toolkit';

const embedder = await loadEmbedder();
const reranker = await loadReranker();
const handle = openIndex('index.db', { embeddingDim: embedder.dim });

const search = createHybridSearch({ handle, embedder });
const rerank = createReranker({ reranker, defaultOpts: { topK: 5 } });

const hybrid = await search('试用期管理规定', { topK: 10 });
const reranked = await rerank('试用期管理规定', hybrid);
// reranked[0]?.rerankScore → ~0.95 (sigmoid(logit))
// reranked[0]?.chunk.content → '试用期管理覆盖入职三个月内的所有同事…'
// reranked[0]?.rrfScore     → preserved from hybrid (FR43 metric breakdown)
// reranked[0]?.bm25Rank     → preserved
```

`RerankedHit extends HybridHit` — every hybrid metric (RRF score, BM25
rank, vec distance) is preserved so tool handlers can build the FR43
`metric breakdown` envelope without re-querying. Output is sorted by
`rerankScore` descending; ties break on `docId` ascending (Story 2.4 H3
symbol comparison). `topK` accepts `Infinity` for "return every
reranked candidate" — matching `createHybridSearch`'s contract.

The FR25 / NFR17 `confidence: 'low'` threshold (default `< 0.5`) is
the tool handler's responsibility (Epic 4 `mcp-hr` owner); the toolkit
exposes `rerankScore` raw.

### `writeRerankerMeta` + `BGE_RERANKER_V2_M3_MANIFEST`

```ts
import {
  BGE_RERANKER_V2_M3_MANIFEST,
  writeRerankerMeta,
} from '@yiong/mcp-chinese-rag-toolkit';

writeRerankerMeta(handle.db, reranker);
// SELECT value FROM meta WHERE key = 'reranker_model'
//   → 'onnx-community/bge-reranker-v2-m3-ONNX'
```

Symmetric to `writeEmbedderMeta` / `writeTokenizerMeta`: pins the
reranker modelId into the on-disk index for provenance / debug.
**Intentionally NOT part of the Story 2.6 cache key** — swapping the
reranker does not invalidate the FTS / vec stores, so the cache key
stays `(toolName, indexVersion, args)`.

`BGE_RERANKER_V2_M3_MANIFEST` is the supply-chain pin — same "edit
the literal, never automate the refresh, run Story 2.7 eval before
bumping" discipline as `BGE_LARGE_ZH_V1_5_MANIFEST`.

### `runStdioLatencyHarness` + `bench/baseline.json`

```bash
pnpm bench                       # measure + diff against bench/baseline.json
pnpm bench -- --write            # overwrite baseline.json (PR-reviewed!)
pnpm bench -- --measure-runs 200 # override sample size (default 100)
```

The CLI wires `loadEmbedder + loadReranker + createHybridSearch +
createReranker` over an in-memory 12-chunk HR fixture, then runs
5 warmup + 100 measured tool calls through an in-process MCP server
pair (`InMemoryTransport.createLinkedPair()`). The resulting snapshot
includes P50/P95/P99 + cold-start + a full environment fingerprint
(`node` / `platform` / `arch` / toolkit + model + jieba versions).

`bench/baseline.json` is committed as a contract file — `pnpm bench`
warns on `> 50ms` P95 drift, and the GitHub Actions bench job emits a
`::warning::` annotation on regressed PRs (warn-not-block in the MVP;
Phase 2 may flip to block). `bench/latest.json` is gitignored
per-run output for CI artifact upload and local diffing.
Cross-platform baselines are NOT comparable (CI Linux x64 vs local
macOS arm64 will skip the numeric diff and print `⚠️ env drift`
instead).

Story 2.6 will wrap the full `hybrid + rerank` pipeline in an LRU
cache (`withLruCache`); cache hits will collapse the entire reranker
forward pass + hybrid query to a single dict lookup, knocking p50 down
to ~0ms for warm queries. Story 2.7 then layers the eval framework on
top to enforce `Hit Rate@5 ≥ 90%` as a CI gate.

## License

MIT (LICENSE file lands in Story 1.5 alongside the ADR migration).
