import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { tokenize } from './fts-tokenizer.js';
import { buildSchema } from './schema.js';
import type {
  Chunk,
  ChunkRow,
  FtsHit,
  IndexHandle,
  IndexStats,
  OpenIndexOptions,
  SchemaOptions,
  SearchOptions,
  VecHit,
} from './types.js';

/** Default top-K — mirrors Story 2.4 hybrid RRF (top-30 each side before fusion). */
const DEFAULT_TOP_K = 30;

const REQUIRED_TABLES = ['docs', 'docs_fts', 'docs_vec', 'meta'] as const;

interface DocRow {
  docId: number;
  content: string;
  source: string | null;
  page: number | null;
  section: string | null;
}

interface FtsRow extends DocRow {
  bm25Score: number;
}

interface VecRow extends DocRow {
  distance: number;
}

function rowToChunk(row: DocRow): Chunk {
  const chunk: Chunk = { content: row.content };
  if (row.source !== null) chunk.source = row.source;
  if (row.page !== null) chunk.page = row.page;
  if (row.section !== null) chunk.section = row.section;
  return chunk;
}

function readEmbeddingDim(db: Database.Database): number {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
    .get('embedding_dim');
  if (!row) {
    throw new Error(
      'Missing meta.embedding_dim — the .db file was not initialized via buildSchema(); call openIndex() with readonly=false at least once before opening read-only.',
    );
  }
  const dim = Number(row.value);
  if (!Number.isInteger(dim) || dim < 1) {
    throw new Error(`Corrupted meta.embedding_dim: expected positive integer, got "${row.value}"`);
  }
  return dim;
}

function assertSchemaPresent(db: Database.Database): void {
  const present = new Set(
    db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')",
      )
      .all()
      .map((r) => r.name),
  );
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new Error(
      `RAG index schema incomplete: missing table(s) ${missing.join(', ')}. ` +
        'Open the .db file once in writable mode (openIndex without readonly) to initialize the schema.',
    );
  }
}

function assertPositiveIntegerTopK(topK: number): void {
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`Invalid topK: expected positive integer, got ${String(topK)}`);
  }
}

function assertEmbeddingShape(value: Float32Array, expectedDim: number, context: string): void {
  if (!(value instanceof Float32Array) || value.length !== expectedDim) {
    const actualLen = value instanceof Float32Array ? value.length : 'non-Float32Array';
    throw new Error(
      `Embedding dimension mismatch${context}: expected Float32Array length ${expectedDim}, got ${actualLen}`,
    );
  }
  // sqlite-vec 0.1.x reads the entire backing buffer when binding a typed-array
  // BLOB; subviews (byteOffset != 0 or shorter than the buffer) corrupt the
  // payload. Reject the misuse explicitly rather than letting it become a
  // silent data bug at query time.
  if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
    throw new Error(
      `Embedding must own its underlying buffer${context}: copy via \`new Float32Array(view)\` before passing.`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const n = value[i];
    if (n === undefined || !Number.isFinite(n)) {
      throw new Error(
        `Embedding contains non-finite value at index ${i}${context}: ${String(n)} — check the embedder output.`,
      );
    }
  }
}

/**
 * Opens (or creates) the SQLite RAG index at `filePath`, loads the `sqlite-vec`
 * extension on the connection, applies the four-table schema when writable,
 * and returns an {@link IndexHandle} wrapping the five storage primitives.
 *
 * Pass `':memory:'` for an ephemeral in-process database — useful for tests
 * and for the Story 2.5 latency-harness.
 *
 * Throws (and closes the underlying connection) when:
 * - the file path is unreachable or extension load fails;
 * - `readonly: true` is passed against a file whose schema is incomplete;
 * - `embeddingDim` disagrees with the dimension persisted in a pre-existing index.
 */
export function openIndex(filePath: string, opts: OpenIndexOptions = {}): IndexHandle {
  const readonly = opts.readonly ?? false;
  const db = new Database(filePath, readonly ? { readonly: true } : {});
  try {
    sqliteVec.load(db);

    if (!readonly) {
      const schemaOpts: SchemaOptions = {};
      if (opts.embeddingDim !== undefined) schemaOpts.embeddingDim = opts.embeddingDim;
      if (opts.indexVersion !== undefined) schemaOpts.indexVersion = opts.indexVersion;
      buildSchema(db, schemaOpts);
    } else {
      assertSchemaPresent(db);
    }

    const embeddingDim = readEmbeddingDim(db);
    return makeHandle(db, embeddingDim);
  } catch (err) {
    if (db.open) db.close();
    throw err;
  }
}

function makeHandle(db: Database.Database, embeddingDim: number): IndexHandle {
  const insertDocs = db.prepare<[string, string | null, number | null, string | null]>(
    'INSERT INTO docs (content, source, page, section) VALUES (?, ?, ?, ?)',
  );
  const insertFts = db.prepare<[number | bigint, string]>(
    'INSERT INTO docs_fts (rowid, text_tokens) VALUES (?, ?)',
  );
  // sqlite-vec 0.1.x requires the vec0 PK column to bind as SQLITE_INTEGER;
  // better-sqlite3 binds plain JS `number` as REAL, so we explicitly coerce
  // the docId to BigInt before handing it to sqlite-vec. The fts index has
  // no such constraint (FTS5 accepts the original number).
  const insertVec = db.prepare<[bigint, Float32Array]>(
    'INSERT INTO docs_vec (doc_id, embedding) VALUES (?, ?)',
  );

  const insertBatch = db.transaction((rows: ChunkRow[]): void => {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row === undefined) {
        throw new Error(`indexChunks rows[${i}] is undefined — sparse arrays are not supported.`);
      }
      const { chunk, embedding } = row;
      if (chunk.content.length === 0) {
        throw new Error(
          `indexChunks rows[${i}] has empty chunk.content — FTS5 would index an unreachable row.`,
        );
      }
      const ctx = ` at row ${i} (source=${chunk.source ?? '<none>'}, page=${
        chunk.page ?? '<none>'
      })`;
      assertEmbeddingShape(embedding, embeddingDim, ctx);
      const result = insertDocs.run(
        chunk.content,
        chunk.source ?? null,
        chunk.page ?? null,
        chunk.section ?? null,
      );
      const docId = result.lastInsertRowid;
      insertFts.run(docId, tokenize(chunk.content));
      insertVec.run(typeof docId === 'bigint' ? docId : BigInt(docId), embedding);
    }
  });

  const ftsStmt = db.prepare<[string, number], FtsRow>(`
    SELECT
      docs.id      AS docId,
      docs.content AS content,
      docs.source  AS source,
      docs.page    AS page,
      docs.section AS section,
      rank         AS bm25Score
    FROM docs_fts
    JOIN docs ON docs.id = docs_fts.rowid
    WHERE docs_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const vecStmt = db.prepare<[Float32Array, number], VecRow>(`
    SELECT
      docs.id      AS docId,
      docs.content AS content,
      docs.source  AS source,
      docs.page    AS page,
      docs.section AS section,
      distance     AS distance
    FROM docs_vec
    JOIN docs ON docs.id = docs_vec.doc_id
    WHERE embedding MATCH ? AND k = ?
    ORDER BY distance
  `);

  const indexVersionStmt = db.prepare<[string], { value: string }>(
    'SELECT value FROM meta WHERE key = ?',
  );

  return {
    indexChunks(rows: ChunkRow[]): IndexStats {
      if (rows.length === 0) {
        return { inserted: 0, durationMs: 0 };
      }
      const start = Date.now();
      insertBatch(rows);
      return { inserted: rows.length, durationMs: Date.now() - start };
    },

    ftsSearch(query: string, opts: SearchOptions = {}): FtsHit[] {
      if (query.length === 0) return [];
      const topK = opts.topK ?? DEFAULT_TOP_K;
      assertPositiveIntegerTopK(topK);
      const tokenized = tokenize(query);
      if (tokenized.length === 0) return [];
      // FTS5 phrase mode — escape embedded quotes by doubling, then wrap.
      // This lets the SQL `MATCH` parser treat the entire tokenized string
      // as a phrase, side-stepping FTS5 operator characters like `*` `(` `)`.
      const matchExpr = `"${tokenized.replace(/"/g, '""')}"`;
      const rows = ftsStmt.all(matchExpr, topK);
      return rows.map((row, i) => ({
        docId: row.docId,
        chunk: rowToChunk(row),
        bm25Rank: i + 1,
        bm25Score: row.bm25Score,
      }));
    },

    vecSearch(queryEmbedding: Float32Array, opts: SearchOptions = {}): VecHit[] {
      assertEmbeddingShape(queryEmbedding, embeddingDim, '');
      const topK = opts.topK ?? DEFAULT_TOP_K;
      assertPositiveIntegerTopK(topK);
      const rows = vecStmt.all(queryEmbedding, topK);
      return rows.map((row) => ({
        docId: row.docId,
        chunk: rowToChunk(row),
        distance: row.distance,
      }));
    },

    getIndexVersion(): string {
      const row = indexVersionStmt.get('index_version');
      if (!row) {
        throw new Error('Missing meta.index_version — index appears uninitialized.');
      }
      return row.value;
    },

    get db() {
      return db;
    },

    close(): void {
      if (db.open) db.close();
    },
  };
}
