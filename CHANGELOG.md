# @yiong/mcp-chinese-rag-toolkit

## 0.7.0

### Minor Changes

- fe0e69f: Three ingestion/retrieval capabilities: xlsx parsing with header-repeating markdown row groups (chunker-friendly tables, section = sheet name), image/png + image/jpeg support with an exported `captionImage` vision bridge (cached, jpeg re-encode, defensive downscale), and `graphRecall` — an opt-in entity-match third recall source fused into hybrid search via N-way RRF (absent hook keeps retrieval byte-identical). Benchmark gains graph on/off A/B configs.

## 0.6.0

### Minor Changes

- e819cea: Ingest: add `parseDocument`, a stateless entry point that turns an uploaded file into a uniform `ParsedDoc` the existing chunkers accept as-is (additive, no breaking changes). It normalizes four whitelisted formats — PDF text layer (`application/pdf`), Word documents (docx), Markdown (`text/markdown`) and plain text (`text/plain`) — delegating every parse to a mature library (PDF via the existing `parsePdf`, docx via `mammoth`); no parser is hand-rolled. PDF documents keep their 1-indexed page numbers on `doc.pages` (ready for `chunkPdfPages`); docx/Markdown/text become heading-preserving text on `doc.text` (ready for `chunk`, whose heading tracker turns `#`–`####` into a `section` provenance path). Markdown and plain-text bytes are decoded as UTF-8 first with an automatic GBK fallback — no charset-detection dependency, using the Node-built-in decoder — and the detected encoding is reported on `doc.encoding`.

  Failure is returned, never thrown, so a single bad file never crashes a batch ingest: the result is a discriminated union `{ ok: true; doc } | { ok: false; error; message }` carrying a stable `INGEST_ERROR_CODES` code — `UNSUPPORTED_MIME_TYPE`, `PARSE_FAILED` (corrupt / encrypted / malformed input), `PARSE_TIMEOUT` (a configurable `timeoutMs` hard ceiling, default `DEFAULT_PARSE_TIMEOUT_MS`) or `EMPTY_DOCUMENT`. The function is side-effect-free and never mutates or detaches its input buffer. Exports `parseDocument`, `DEFAULT_PARSE_TIMEOUT_MS`, `INGEST_ERROR_CODES`, and the `ParsedDoc` / `ParseResult` / `ParseDocumentOptions` / `SupportedMimeType` / `IngestErrorCode` types.

- 89a903f: Knowledge graph: add stateless primitives to grow an entity / relation graph from already-indexed chunks and store it alongside the vectors and full-text index (additive, no breaking changes). The graph tables live in the **same `.db` file** as the existing `docs` / vector / FTS tables, so the graph travels with that index version; rebuilding the corpus into a fresh version starts with no graph.

  - `buildGraphSchema(db)` — idempotent DDL (`IF NOT EXISTS`) that adds `entities`, `relations` and their `*_mentions` back-link tables in place. Safe to call on any already-built index to opt it into graph storage; it never touches the core tables, and a graph-less database still opens read-only unchanged.
  - `extractGraph({ chunks, extractFn })` — pure orchestration that turns chunks into a deduplicated graph. Extraction is fully injected via `extractFn` (wire it to any LLM provider, a rule-based extractor, or a test stub) — the toolkit ships no default extractor and depends on no model SDK. Entities and relations collapse onto a deterministic, NFKC-based normalized key so re-extracting the same corpus produces no duplicate nodes; each node and edge back-links to the source chunk(s) it was mentioned in; relation endpoints are registered as nodes so the graph is always connected; and a single chunk whose `extractFn` throws (or resolves a malformed result) is skipped and counted in `failedChunks` rather than aborting the batch.
  - `writeGraph(db, graph)` — persists an extracted graph in one transaction, idempotently: entities and relations use `INSERT OR IGNORE` against a `UNIQUE` normalized key and mention rows use a composite primary key, so writing the same graph twice inserts nothing and leaves node / edge counts unchanged.

  `extractGraph` accepts an optional `onSpan` callback that emits one `ingest.graph` span carrying scalar counts only (chunk / entity / relation / failed counts) — never names or chunk content — so it is safe to export to an observability backend. Uses only Node built-ins and the existing SQLite dependency; no new dependencies. Exports `buildGraphSchema`, `extractGraph`, `writeGraph`, `GRAPH_ERROR_CODES`, `GraphError`, and the `GraphChunk` / `ExtractFn` / `RawEntity` / `RawRelation` / `RawExtraction` / `ExtractedEntity` / `ExtractedRelation` / `ExtractedGraph` / `GraphExtractionOptions` / `GraphStats` / `GraphErrorCode` types.

- 0c1faaa: Observability: the retrieval and ingest pipelines can now emit structured `PipelineSpan` events through an optional, injected `onSpan` callback, so you can bridge pipeline timing to any observability backend without the toolkit depending on a tracing SDK (additive, no breaking changes).

  Pass `onSpan` on the per-call options of the bound hybrid search (`createHybridSearch`), the bound reranker (`createReranker`), `parseDocument`, or `IndexStore.buildVersion`. Each pipeline stage then emits one span:

  - `createHybridSearch` emits a `retrieve.hybrid` parent span with `retrieve.bm25` / `retrieve.vector` / `retrieve.rrf` child spans (each child's `parentId` is the hybrid span's `id`).
  - `createReranker` emits a `retrieve.rerank` span (including a zero-candidate span when the input list is empty).
  - `parseDocument` emits one `ingest.parse` span per call, for successful and failed parses alike.
  - `IndexStore.buildVersion` emits an `ingest.index` span on a successful build.

  Each span carries a name, an id and optional `parentId`, `startedAtEpochMs`, `durationMs`, and a scalar-only `attributes` map (counts, scores, dimensions, format enums, error codes). Spans are metadata only — never query text, chunk content, source or file names — so they are safe to export to an external backend. Pass an outer span id via `parentSpanId` to graft the toolkit's spans under your own trace.

  When no `onSpan` is provided the pipelines read no clock, mint no id and allocate no span object, so the hot path is unchanged and there is zero overhead. Uses only Node built-ins (`node:crypto`, `performance`, `Date`) — no new dependencies. Exports the `PipelineSpan`, `PipelineSpanName`, `OnSpan` and `SpanAttributeValue` types.

- e819cea: RAG store: add `openIndexStore`, a versioned wrapper over `openIndex` that lets a running service re-index a corpus and switch over without interrupting in-flight queries (additive, no breaking changes — `openIndex` and its handle are untouched). It keeps per-corpus version files (`v<N>.db`) plus a single `manifest.json` pointer, and exposes `buildVersion(rows)` (full rebuild into a fresh version file — decoupled from going live, so a slow rebuild never stalls current queries), `swap(version?)` (atomically flip the serving pointer via a temp-file + `rename`, so a reader or a crash never sees a half-written manifest), `rollback()` (step the pointer back one version), and `withHandle(fn)` for running a query against the current version.

  Handle lifetime is reference-counted: a query that started before a `swap` keeps reading the pre-swap version to completion, and that version's connection is only closed once its last in-flight reader releases it. Old version files are pruned to a configurable `keepVersions` window (default 2), but the current version, its one-step rollback target, and any version with an in-flight reader are never deleted — a reader-held version's `.db` (with its WAL/SHM sidecars) is unlinked only after the reader releases. Building an empty corpus is refused, and a malformed or inconsistent `manifest.json` fails fast with a typed `IndexStoreError` (`err.code`, e.g. `EMPTY_CORPUS` / `CORRUPT_MANIFEST` / `VERSION_NOT_FOUND`). Zero new dependencies — pure `node:fs` over the existing `better-sqlite3` path. Exports `openIndexStore`, `IndexStoreError`, `INDEX_STORE_ERROR_CODES`, and the `IndexStore` / `IndexStoreOptions` / `BuildVersionResult` / `IndexStoreErrorCode` types.

## 0.5.0

### Minor Changes

- 42a9bf2: Query: add history-aware query rewriting as a stateless pure function. `rewriteQuery({ history, query, generateFn })` asks a caller-injected language model to rewrite a context-dependent query (pronouns, omitted subjects) into a self-contained retrieval query, using the conversation history the caller supplies. The outcome is a discriminated union that is honest by construction: `model` (a cleaned rewrite), `short-circuit` (blank query or empty/blank history — the model is never called), or `degraded` (timeout or unusable output — the original query is kept, with a `reason`). Conversation history and the query are embedded as fenced untrusted data (data preface + declared length + content-derived sentinel), never as bare instruction. Also exports `buildRewritePrompt`, `REWRITE_PROMPT_VERSION` (stamp for run metadata, bumped on any prompt wording change), and `DEFAULT_REWRITE_TIMEOUT_MS`. The caller controls the history window; non-timeout `generateFn` rejections (network/auth/provider faults) propagate unchanged.
- 07cc542: Eval: add optional multi-turn conversation history to eval cases. `EvalQuery` gains `history?: ConversationTurn[]` (declared per query in the eval-set YAML, oldest-first); `loadEvalSet` validates the shape (role must be `user` or `assistant`, content a non-empty string) and fails fast with the exact `queries[i].history[j]` location on authoring mistakes. The harness passes the history through verbatim to the injected `searchFn` (new optional `history` in its options) and `generateFn` (new optional `history` on its input) — it never consumes history itself, so whether retrieval or generation is history-aware stays entirely the caller's decision. Purely additive: single-turn eval sets, existing callers, and history-agnostic functions are unaffected.

  Also re-exports `aggregateAnswerMeans` (the per-query answer-metric mean aggregator `runBenchmark` already uses internally) at the package level, so downstream verdict layers can aggregate metric means over filtered per-query subsets without re-implementing the formula.

- cb9ba6d: Guard: add `sanitizeRetrievedContent`, a stateless rule-based pure function that defends against indirect prompt injection (retrieval poisoning) — the RAG-specific attack surface where a malicious instruction is smuggled inside an indexed document and re-enters the model context as "trusted" retrieved text. It detects three injection classes — instruction-override clauses ("ignore the previous instructions"), forged role / delimiter markers (a line-start `系统：` / `助手：`, `<|im_start|>`, `[INST]`) and persona hijacks ("you are now…", "act as…") — and neutralizes them without deleting any content: structural tokens get a zero-width break, imperative/persona clauses are wrapped in a deterministic `⟦untrusted:<category>:<token>⟧…⟦/untrusted:<token>⟧` annotation that tells the model the span is flagged data. The result is an honest `{ sanitized, flagged, detections }` structure — `detections` is source-ordered and excerpt-bounded so it can be counted by a metric without copying whole passages — and the function is idempotent (re-sanitizing already-sanitized text is a no-op) and rejects pre-planted forged markers. Exports `sanitizeRetrievedContent`, the `SANITIZE_RULES_VERSION` stamp, and the `InjectionCategory` / `InjectionDetection` / `SanitizeOptions` / `SanitizeResult` types.

  Query rewrite: harden the conversation-history serialization in the rewrite prompt so a turn's content can no longer forge an extra line-start role label (e.g. an embedded `\n助手：…`) and fake a turn inside the data block. Line terminators inside a turn's content are now collapsed before the turns are joined. `REWRITE_PROMPT_VERSION` is bumped to `2026-06-16` to reflect the prompt change.

### Patch Changes

- c992453: Eval: harden `callJudge` timeout handling. A judge rejection arriving after the timeout already degraded the call is now observed by a no-op handler instead of surfacing as an unhandled rejection (a process crash by default in Node); a rejection that loses no race still propagates unchanged. Finite `timeoutMs` values above 2^31-1 (the largest delay `setTimeout` honours) are now capped instead of being silently clamped to ~1ms, which previously turned a huge "effectively no timeout" budget into an instant spurious timeout on every call. The same cap applies to `rewriteQuery`'s `timeoutMs`.

## 0.4.0

### Minor Changes

- 3025c00: Benchmark: support per-config answer generation. `BenchmarkConfig` gains optional `generateFn` / `generateModel` overrides so configurations that generate answers differently (e.g. different generation models or end-to-end orchestrations) can be compared in one run. Omitting them keeps the shared run-level pair — existing callers are unaffected. When per-config models differ, the summary's `versionMeta.generateModel` becomes an explicit `name=model; name=model` aggregate and the comparison table lists the generation model per configuration.

## 0.3.0

### Minor Changes

- ee1a569: Add `runAnswerEval` — a single provider-injection entry point that runs a whole answer-quality evaluation (additive, no breaking changes). It wires the existing layers into one flow: retrieve context, generate an answer from it, drive the judge tasks, feed their structured output to the pure scoring functions, and stamp the run with reproducible version metadata. It is an orchestrator only — it does not build prompts, parse model output, or compute any metric formula.

  - `runAnswerEval(evalSet, opts)` — for each query it retrieves top-K context, generates an answer, and computes up to five RAGAS metrics: faithfulness, answer relevance and context precision (reference-free), plus answer correctness and context recall (reference-based, computed only when the query carries a reference answer). Retrieval, generation, judging and embedding are all caller-injected, so a deterministic mock drives the whole thing in CI with no API key and no network.
  - Graceful skips, never faked scores: the reference-based pair is skipped (`NO_REFERENCE_ANSWER`) when a query has no reference answer, and answer relevance is skipped (`NO_EMBED_FN`) when no embed function is injected. A degraded judge call (timeout or malformed output) skips just its own metric.
  - Resilient per query, like the retrieval runner: a fault fatal to one query — a throwing search/generate function, a missing chunk, or a judge infrastructure rejection — is recorded on that query's row and the run continues. An embed-function failure is localized to answer relevance, its only consumer.
  - Reproducible version metadata `{ generateModel, judgeModel, judgePromptVersion, toolkitVersion, evalSpecVersion }` is stamped onto every run, with each field carrying its own provenance (model names are caller-injected, the toolkit version is read from package.json, never hardcoded), so scores stay comparable and auditable across time and configurations.
  - New types `GenerateFn`, `EmbedFn`, `AnswerEvalOptions`, `AnswerEvalMetrics`, `AnswerEvalQueryResult`, `AnswerEvalSummary` and `AnswerEvalVersionMeta` are exported from the package root.

  `answerCorrectness` reports the statement-level F1 component only; the full RAGAS metric blends it with an answer–reference semantic similarity term, which needs another embedding pass and is left to a later calibration step.

- 69e9ac4: Add `runBenchmark` — run one eval set through several named retrieval configurations and lay the results out as a single comparison table (additive, no breaking changes). It is an orchestrator only: it reuses the retrieval runner, the answer-eval orchestrator and the ranking-gain metric, and reimplements none of their formulas.

  - `runBenchmark(evalSet, opts)` — for each `{ name, searchFn }` configuration it scores retrieval (Hit Rate@K, MRR, and a mean nDCG@K derived from the existing expected-hit labels) and answer quality (the five RAGAS metrics), keeping the full per-config sub-results alongside the aggregates. Each row is stamped with the same reproducible version metadata, so the table is comparable and auditable across runs.
  - Stays provider-agnostic: the toolkit never learns how a retrieval configuration is built (reranking, lexical vs vector, tokenizer choices). The caller pre-wires each configuration as a `searchFn`; the toolkit only iterates over them.
  - `renderBenchmarkTable(summary)` — render the comparison as deterministic GitHub-flavoured markdown, one row per configuration. A never-measured answer metric renders as `n/a` (never faked to `0`), and there is deliberately no aggregate "overall" column — the metrics measure different things on different scales.
  - New types `BenchmarkConfig`, `BenchmarkOptions`, `BenchmarkConfigResult` and `BenchmarkSummary` are exported from the package root.

  The mean nDCG@K is derived from the existing binary expected-hit labels (a hit scores gain `1`, a miss `0`); even so it is informative, rewarding a configuration that ranks a hit higher — something Hit Rate@K and MRR do not capture. Graded relevance labels are a future, purely-additive extension.

- c389b63: Extend the eval framework (additive, no breaking changes):

  - `EvalQuery` gains an optional `referenceAnswer` field, parsed and validated by `loadEvalSet` (must be a non-empty string when present). Reference-based answer metrics can consume it; retrieval scoring ignores it.
  - New `assertContentPopulated(result)` content guard plus a lean eval error layer (`EvalFrameworkError`, `evalError`, `EVAL_ERROR_CODES` with `EVAL_CONTENT_MISSING`). It throws on missing/blank chunk content so answer-quality metrics fail loudly instead of silently scoring low.
  - Raise the supported Node engine to `>=22`.

- 9cbcdfa: Add a judge result cache and benchmark query sampling (additive, no breaking changes).

  - `withJudgeCache(judgeFn, opts)` wraps a judge function so identical calls are memoized. The cache key is a content hash of the prompt (via `computeJudgeCacheKey`), so only hashes are stored — never the raw prompt or output. `createMemoryJudgeCacheStore(max?)` provides a default bounded in-memory store, and the `JudgeCacheStore` / `JudgeCacheOptions` types let callers plug in their own. Caching is opt-in at the call site, so variance sampling (which must drive the raw judge) is never collapsed to a single cached value.
  - `sampleQueries(evalSet, n, opts?)` deterministically selects a subset of an eval-set, so a benchmark can run a cheap PR-smoke subset and the full set on a nightly schedule from the same data.

  Both are exported from the package root.

- 7ba049f: Add the LLM-facing judge layer to the eval framework (additive, no breaking changes). This is the impure counterpart to the pure scoring functions: it builds a prompt, calls an injected judge, and parses the model's text into the structured inputs the scoring layer consumes — keeping that scoring layer pure.

  - `callJudge(judgeFn, prompt, parse, opts?)` — drives a judge function, racing it against a wall-clock timeout and parsing the result. It NEVER throws for the two judge-output failure modes: a timeout degrades to `EVAL_JUDGE_TIMEOUT` (retryable) and unparseable / wrong-shape output degrades to `EVAL_JUDGE_MALFORMED_OUTPUT` (not retryable), both returned as a discriminated `JudgeOutcome`. A non-timeout rejection from the judge itself (e.g. a provider error) propagates unchanged.
  - Five judge tasks — `judgeClaimSupport`, `judgeReverseQuestions`, `judgeContextUsefulness`, `judgeStatementClassification`, `judgeContextAttribution` — each build a prompt and parse the judge's JSON (tolerant of code fences and surrounding prose) into the structured input one scoring metric consumes. Output is validated against the target shape (required fields and value types are enforced; unrecognized extra keys are ignored).
  - New types `JudgeFn` (`(prompt: string) => Promise<string>`), `JudgeCallOptions`, `JudgeOutcome<T>`, and the lean degrade core `EvalErrorCore`, plus the `JUDGE_PROMPT_VERSION` and `DEFAULT_JUDGE_TIMEOUT_MS` constants and the two new error codes, are exported from the package root.

  The judge signature is provider-agnostic and free of any business / envelope fields, so the layer can be exercised in CI with a deterministic mock judge — no API keys and no network.

  Also reject negative graded labels in `ndcg` (alongside the existing non-finite guard), since a negative gain would push the score outside the documented `[0, 1]` range.

- 219adc1: Add reference-based answer-quality scoring and a graded-relevance ranking metric to the eval framework (additive, no breaking changes):

  - `answerCorrectness(statements)` — statement-level F1 between an answer and a gold reference, from per-statement TP/FP/FN classifications (`2·tp / (2·tp + fp + fn)`). Returns precision, recall, and the raw counts for auditing. Implements the factual F1 component only; the optional semantic-similarity term is left to the caller so the function stays embedding-free.
  - `contextRecall(attributedFlags)` — fraction of reference sentences attributable to the retrieved context. A sentence counts only when its flag is strictly `true`.
  - `ndcg(gains, opts?)` — Normalized Discounted Cumulative Gain over a ranked list of graded relevance labels, complementing the existing binary Hit Rate@K / MRR@K. Uses the standard linear gain with a log2 position discount (`DCG@k / IDCG@k`); `opts.k` truncates the ranking. Returns the raw `dcg` / `idcg` / effective `k` for auditing.

  All three are deterministic pure functions (no model calls, no embedding calls, no I/O), so they can be regression-tested offline with no API keys. New result/input types (`AnswerCorrectnessStatement`, `AnswerCorrectnessResult`, `ContextRecallResult`, `NdcgResult`, `CorrectnessLabel`) are exported from the package root. Structurally malformed input (a non-array, a non-finite gain, or a bad `k`) throws the existing coded `EvalFrameworkError` (`EVAL_INVALID_METRIC_INPUT`).

- e115b92: Add reference-free answer-quality scoring to the eval framework (additive, no breaking changes):

  - `faithfulness(verdicts)` — fraction of an answer's atomic claims supported by the retrieved context (`0/0 → 0`).
  - `answerRelevance({ queryEmbedding, generatedQuestionEmbeddings })` — mean cosine similarity between the original query and reverse questions generated from the answer (unclamped, ∈ [-1, 1]).
  - `contextPrecision(usefulFlags)` — order-sensitive average precision over a ranked list of useful/not-useful chunks.
  - `cosineSimilarity(a, b)` helper — zero-norm vectors yield `0`; length mismatch or non-finite values throw a coded `EvalFrameworkError`.

  All four are deterministic pure functions (no model calls, no embedding calls, no I/O), so they can be regression-tested offline with no API keys. New result/input types (`ClaimVerdict`, `FaithfulnessResult`, `AnswerRelevanceInput`, `AnswerRelevanceResult`, `ContextPrecisionResult`) and a new `EVAL_INVALID_METRIC_INPUT` error code are exported from the package root.

## 0.2.1

### Patch Changes

- f3dad22: Docs hygiene: rewrite the README, source comments and generated API docs in
  plain user-facing language. Strips internal development-process references
  (story/epic numbers, requirement IDs, private downstream-package names, private
  planning-doc paths) that have no meaning to external users of a public package,
  and adds a `check-public-hygiene` CI gate that fails the build if such jargon is
  reintroduced. Documentation-only — no API, type, or runtime behaviour change.

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
