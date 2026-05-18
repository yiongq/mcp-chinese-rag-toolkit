import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CaptionCacheEntry } from './types.js';

/**
 * Caption SQLite cache — DISTINCT from `IndexHandle.db` (Story 2.2 main
 * index file) AND from `withLruCache` L0 tool-result cache (Story 2.6).
 *
 * Architecture §缓存策略 L639 explicitly carves this out: "索引期 plugin
 * 自带的离线 cache 属不同层级，不在此约束内". Reuses `better-sqlite3`
 * (already in toolkit `dependencies`) but lives in its OWN file under
 * `<cacheDir>/captions.db` so re-indexing the same PDF with the same
 * (prompt, provider, model) costs zero LLM tokens.
 */
export interface CaptionCacheOptions {
  /** Cache directory; `captions.db` lives at `<cacheDir>/captions.db`. */
  cacheDir: string;
}

/**
 * 4-tuple primary-key lookup args used by {@link CaptionCache.get}.
 */
export interface CaptionCacheLookup {
  imageSha256: string;
  promptSha256: string;
  providerId: string;
  modelId: string;
}

/**
 * Plugin-owned caption cache. Single underlying `better-sqlite3` handle;
 * caller MUST invoke `close()` exactly once (see `with-vision-caption.ts`
 * try/finally pattern, Story 2.5 教训 1).
 */
export interface CaptionCache {
  /** Look up a cached caption; returns `undefined` on miss. */
  get(args: CaptionCacheLookup): CaptionCacheEntry | undefined;
  /** Persist (or replace) a caption row. Idempotent (`INSERT OR REPLACE`). */
  set(entry: CaptionCacheEntry): void;
  /**
   * Compute SHA-256 hex digest. Re-exported on the cache instance so
   * callers can hash before they decide whether to spend a provider call.
   */
  readonly hash: (buf: Uint8Array | string) => string;
  /** Close the underlying SQLite handle. Idempotent. */
  close(): void;
}

const CACHE_SUBPATH = path.join('mcp-chinese-rag-toolkit', 'caption-cache');

/**
 * Resolve the default per-user caption cache directory. Mirrors the
 * env-paths semantics used by Story 2.3 `resolveCacheDir` for the model
 * cache — same prefer-XDG-CACHE-HOME order — but writes under a sibling
 * `caption-cache/` subpath so the model cache (multi-GB ONNX files) and
 * the caption cache (small SQLite DB) never collide.
 *
 * Returned directory is lazily created with `recursive: true`.
 */
export function resolveDefaultCaptionCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  let base: string;
  if (xdg && xdg !== '') {
    base = xdg;
  } else if (process.platform === 'darwin') {
    base = path.join(homedir(), 'Library', 'Caches');
  } else if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    base =
      localAppData && localAppData !== '' ? localAppData : path.join(homedir(), 'AppData', 'Local');
  } else {
    base = path.join(homedir(), '.cache');
  }
  const dir = path.join(base, CACHE_SUBPATH);
  ensureDir(dir);
  return dir;
}

/**
 * Wrap mkdirSync so EACCES / EROFS / ENOTDIR surfaces with the actual
 * path instead of an opaque errno-only stack. Re-throws everything else
 * verbatim.
 */
function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `caption-cache: failed to create cache directory '${dir}'. ` +
        `Check filesystem permissions / read-only mount. Underlying error: ${detail}`,
    );
  }
}

/**
 * Open (or create) the caption cache. Schema is created on demand:
 *
 *   CREATE TABLE IF NOT EXISTS image_caption_cache (
 *     image_sha256  TEXT NOT NULL,
 *     prompt_sha256 TEXT NOT NULL,
 *     provider_id   TEXT NOT NULL,
 *     model_id      TEXT NOT NULL,
 *     caption_text  TEXT NOT NULL,
 *     created_at    TEXT NOT NULL,
 *     PRIMARY KEY (image_sha256, prompt_sha256, provider_id, model_id)
 *   )
 */
export function openCaptionCache(opts: CaptionCacheOptions): CaptionCache {
  if (typeof opts.cacheDir !== 'string' || opts.cacheDir === '') {
    throw new Error('openCaptionCache: opts.cacheDir must be a non-empty string');
  }
  ensureDir(opts.cacheDir);
  const dbPath = path.join(opts.cacheDir, 'captions.db');
  const db = new Database(dbPath);
  // WAL + a generous busy_timeout so two indexer processes (CLI users
  // are encouraged to parallelize across PDFs) don't get SQLITE_BUSY
  // when they upsert into the same captions.db. WAL is also fsync-cheap
  // for the insert-heavy workload of a first-time index.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_caption_cache (
      image_sha256  TEXT NOT NULL,
      prompt_sha256 TEXT NOT NULL,
      provider_id   TEXT NOT NULL,
      model_id      TEXT NOT NULL,
      caption_text  TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (image_sha256, prompt_sha256, provider_id, model_id)
    )
  `);

  const selectStmt = db.prepare<
    [string, string, string, string],
    {
      image_sha256: string;
      prompt_sha256: string;
      provider_id: string;
      model_id: string;
      caption_text: string;
      created_at: string;
    }
  >(
    'SELECT image_sha256, prompt_sha256, provider_id, model_id, caption_text, created_at ' +
      'FROM image_caption_cache ' +
      'WHERE image_sha256 = ? AND prompt_sha256 = ? AND provider_id = ? AND model_id = ?',
  );

  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO image_caption_cache ' +
      '(image_sha256, prompt_sha256, provider_id, model_id, caption_text, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
  );

  let closed = false;

  return {
    get(args) {
      if (closed) throw new Error('CaptionCache.get: cache is closed');
      const row = selectStmt.get(
        args.imageSha256,
        args.promptSha256,
        args.providerId,
        args.modelId,
      );
      if (!row) return undefined;
      return {
        imageSha256: row.image_sha256,
        promptSha256: row.prompt_sha256,
        providerId: row.provider_id,
        modelId: row.model_id,
        captionText: row.caption_text,
        createdAt: row.created_at,
      };
    },
    set(entry) {
      if (closed) throw new Error('CaptionCache.set: cache is closed');
      upsertStmt.run(
        entry.imageSha256,
        entry.promptSha256,
        entry.providerId,
        entry.modelId,
        entry.captionText,
        entry.createdAt,
      );
    },
    hash: sha256Hex,
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}

/**
 * Compute the SHA-256 digest of a buffer or string as lowercase hex.
 * Strings are encoded as UTF-8 before hashing so digests match the
 * common-case `crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))`
 * shape and stay stable across platforms.
 *
 * Exported separately from {@link CaptionCache.hash} so callers can hash
 * outside the cache lifecycle (e.g. in tests, or when composing a cache
 * key before opening the DB).
 */
export function sha256Hex(input: Uint8Array | string): string {
  const h = createHash('sha256');
  h.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return h.digest('hex');
}
