export { chunk, chunkPdfPages } from './chunking.js';
export {
  DEFAULT_PREFIX_LENGTH,
  generateChunkContext,
  renderChunkContextPrompt,
  stitchPrefixedChunk,
} from './contextual-retrieval.js';
export { loadEmbedder, writeEmbedderMeta } from './embedder.js';
export { tokenize } from './fts-tokenizer.js';
export { createHybridSearch } from './hybrid-search.js';
export { percentile, runStdioLatencyHarness } from './latency-harness.js';
export {
  configureTransformersEnv,
  ModelFileMissingError,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from './model-loader.js';
export { BGE_LARGE_ZH_V1_5_MANIFEST, BGE_RERANKER_V2_M3_MANIFEST } from './model-manifest.js';
export { parsePdf } from './pdf-parser.js';
export * from './plugins/index.js';
export { createReranker, loadReranker } from './reranker.js';
export { writeRerankerMeta } from './reranker-meta.js';
export { rrfFuse } from './rrf.js';
export { buildSchema } from './schema.js';
export { openIndex } from './sqlite-store.js';
export { JIEBA_VERSION, writeTokenizerMeta } from './tokenizer-meta.js';
export type {
  CacheOptions,
  CacheStatus,
  Chunk,
  ChunkOptions,
  ChunkRow,
  ContextualRetrievalOptions,
  Embedder,
  EmbedderOptions,
  FtsHit,
  FusedRow,
  HarnessResult,
  HybridHit,
  HybridSearchDeps,
  HybridSearchFn,
  HybridSearchOptions,
  IndexHandle,
  IndexStats,
  LatencyHarnessOptions,
  LatencySnapshot,
  LlmProvider,
  ManifestEntry,
  ModelManifest,
  OpenIndexOptions,
  ParsePdfResult,
  PdfPage,
  RankedDocument,
  RankedRow,
  RerankedHit,
  Reranker,
  RerankerDeps,
  RerankerOptions,
  RerankFn,
  RerankOptions,
  RrfOptions,
  SchemaOptions,
  SearchOptions,
  VecHit,
  WithLruCacheDeps,
} from './types.js';
