export { chunk, chunkPdfPages } from './chunking.js';
export { loadEmbedder, writeEmbedderMeta } from './embedder.js';
export { tokenize } from './fts-tokenizer.js';
export {
  configureTransformersEnv,
  ModelFileMissingError,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from './model-loader.js';
export { BGE_LARGE_ZH_V1_5_MANIFEST } from './model-manifest.js';
export { parsePdf } from './pdf-parser.js';
export { buildSchema } from './schema.js';
export { openIndex } from './sqlite-store.js';
export type {
  Chunk,
  ChunkOptions,
  ChunkRow,
  Embedder,
  EmbedderOptions,
  FtsHit,
  IndexHandle,
  IndexStats,
  ManifestEntry,
  ModelManifest,
  OpenIndexOptions,
  ParsePdfResult,
  PdfPage,
  SchemaOptions,
  SearchOptions,
  VecHit,
} from './types.js';
