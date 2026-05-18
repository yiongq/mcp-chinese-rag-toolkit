/**
 * __PROJECT_NAME__ — build the SQLite FTS5 index from data/sample-doc.md.
 * Run once per change to the source documents:
 *
 *   pnpm build-index
 *
 * For instant hello-world this uses MOCK zero-vector embeddings + FTS5
 * (jieba) only. To switch to the real bge-large-zh-v1.5 embedder, replace
 * the mock with `await loadEmbedder()` + `embedder.embedBatch(...)`
 * (downloads ~400 MB model on first run). See the toolkit README §Embedder.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunk, openIndex } from '@yiong/mcp-chinese-rag-toolkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const indexPath = path.join(projectRoot, 'data', 'index.db');
const docPath = path.join(projectRoot, 'data', 'sample-doc.md');

const text = readFileSync(docPath, 'utf-8');
const chunks = await chunk(text, { chunkSize: 256, chunkOverlap: 50, source: 'sample-doc.md' });

const handle = openIndex(indexPath, { embeddingDim: 1024 });
try {
  const rows = chunks.map((c) => ({
    chunk: c,
    embedding: new Float32Array(1024).fill(0),
  }));
  const stats = handle.indexChunks(rows);
  console.log(
    `Indexed ${stats.inserted} chunks → ${indexPath} (took ${stats.durationMs.toFixed(1)} ms)`,
  );
  console.log(
    'Hello-world note: using MOCK zero-vector embeddings. Switch to bge-large-zh-v1.5 by editing this file.',
  );
} finally {
  handle.close();
}
