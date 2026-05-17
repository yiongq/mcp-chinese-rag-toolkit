export { chunk, chunkPdfPages } from './chunking.js';
export { loadEmbedder, writeEmbedderMeta } from './embedder.js';
export { tokenize } from './fts-tokenizer.js';
export { createHybridSearch } from './hybrid-search.js';
export {
  configureTransformersEnv,
  ModelFileMissingError,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from './model-loader.js';
export { BGE_LARGE_ZH_V1_5_MANIFEST } from './model-manifest.js';
export { parsePdf } from './pdf-parser.js';
export { rrfFuse } from './rrf.js';
export { buildSchema } from './schema.js';
export { openIndex } from './sqlite-store.js';
export { JIEBA_VERSION, writeTokenizerMeta } from './tokenizer-meta.js';
export type {
  Chunk,
  ChunkOptions,
  ChunkRow,
  Embedder,
  EmbedderOptions,
  FtsHit,
  FusedRow,
  HybridHit,
  HybridSearchDeps,
  HybridSearchFn,
  HybridSearchOptions,
  IndexHandle,
  IndexStats,
  ManifestEntry,
  ModelManifest,
  OpenIndexOptions,
  ParsePdfResult,
  PdfPage,
  RankedRow,
  RrfOptions,
  SchemaOptions,
  SearchOptions,
  VecHit,
} from './types.js';
