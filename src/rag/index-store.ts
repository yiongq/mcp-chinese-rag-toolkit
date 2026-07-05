import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openIndex } from './sqlite-store.js';
import type { ChunkRow, IndexHandle, IndexStats } from './types.js';

// ---------------------------------------------------------------------------
// Versioned index store — build a new index file, atomically hot-swap the
// serving pointer, and roll back — without interrupting in-flight queries.
// ---------------------------------------------------------------------------
//
// Why a version store on top of `openIndex`:
//
// A SQLite read-only handle cannot be rewritten in place, so re-indexing a
// corpus means writing a *new* `.db` file and switching the reader over. Doing
// that safely under concurrent reads is the hard part. The store models it as:
//
//   1. `buildVersion(rows)` — full rebuild into a fresh `v<N>.db` file. Never
//      touches the pointer, so a slow rebuild does not stall live queries.
//   2. `swap()` — atomically flip a `manifest.json` pointer to the new version
//      (temp file + `rename`, POSIX-atomic on one filesystem). New queries pick
//      up the new handle; queries already in flight keep the old handle open and
//      read to completion. Handle lifetime is reference-counted: an old version's
//      connection is only closed once its last in-flight reader releases it.
//   3. `rollback()` — flip the pointer back one version.
//
// `buildVersion` delegates every write and read to the existing `openIndex`
// path; it never re-implements insertion or search. Everything else here is
// pointer bookkeeping and file lifecycle.

/** Default vector dimension — matches the bundled bge-large-zh-v1.5 embedder. */
const DEFAULT_EMBEDDING_DIM = 1024;

/**
 * Number of versions to retain on disk when pruning after a swap / rollback.
 * The current version and its one-step rollback target are ALWAYS retained on
 * top of this window, so a rollback is always possible even when
 * `keepVersions` is `1`.
 */
const DEFAULT_KEEP_VERSIONS = 2;

const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_TMP_FILENAME = 'manifest.json.tmp';

/**
 * Registry of stable error codes thrown by the index store. SCREAMING_SNAKE_CASE
 * string literals so callers can branch on a known set without matching on
 * message text. Declared `as const` so new codes append without a breaking
 * change.
 */
export const INDEX_STORE_ERROR_CODES = {
  /** `buildVersion` was called with an empty `rows` array — refusing to build an empty index. */
  EMPTY_CORPUS: 'EMPTY_CORPUS',
  /** `withHandle` was called before any version has been made current via `swap`. */
  NO_CURRENT_VERSION: 'NO_CURRENT_VERSION',
  /** `swap(version)` targeted a version that is not present in the manifest. */
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  /** `rollback` was called but no earlier version exists to roll back to. */
  NO_PREVIOUS_VERSION: 'NO_PREVIOUS_VERSION',
  /** An operation was attempted after `close()`. */
  STORE_CLOSED: 'STORE_CLOSED',
  /** The requested `embeddingDim` disagrees with the dimension recorded in an existing manifest. */
  EMBEDDING_DIM_CONFLICT: 'EMBEDDING_DIM_CONFLICT',
  /** The on-disk `manifest.json` is missing required fields, malformed, or internally inconsistent. */
  CORRUPT_MANIFEST: 'CORRUPT_MANIFEST',
} as const;

/** Union of the registered index-store error codes. */
export type IndexStoreErrorCode =
  (typeof INDEX_STORE_ERROR_CODES)[keyof typeof INDEX_STORE_ERROR_CODES];

/**
 * Typed error raised by the index store. Carries a stable {@link IndexStoreErrorCode}
 * so callers can branch on `err.code` (mirrors the eval layer's typed-error
 * convention) while still reading as a normal `Error`.
 */
export class IndexStoreError extends Error {
  readonly code: IndexStoreErrorCode;

  constructor(code: IndexStoreErrorCode, message: string) {
    super(message);
    this.name = 'IndexStoreError';
    this.code = code;
    // Keep a correct prototype chain so `instanceof IndexStoreError` holds even
    // when compiled down to older targets.
    Object.setPrototypeOf(this, IndexStoreError.prototype);
  }
}

/** Options for {@link openIndexStore}. */
export interface IndexStoreOptions {
  /**
   * Vector dimension, forwarded to `openIndex` on every build and therefore
   * constant across versions (the `docs_vec float[N]` DDL is locked per file).
   * When a manifest already exists, its recorded dimension wins and a
   * conflicting value here is rejected. @default 1024
   */
  embeddingDim?: number;
  /**
   * How many versions to retain on disk when pruning after a swap / rollback.
   * The current version and its one-step rollback target are always kept on top
   * of this window. @default 2
   */
  keepVersions?: number;
}

/** Result of a successful {@link IndexStore.buildVersion}. */
export interface BuildVersionResult {
  /** The version number assigned to the freshly built index file. */
  version: number;
  /** Insertion statistics from the underlying `indexChunks` batch. */
  stats: IndexStats;
}

/**
 * A versioned SQLite index store bound to a single corpus directory.
 *
 * Layout on disk: `<corpusDir>/v<N>.db` per built version plus a single
 * `manifest.json` pointer file recording the current version and the retained
 * version list.
 */
export interface IndexStore {
  /**
   * Full-rebuild a new version from `rows` into `v<N>.db` and return its number.
   * Does NOT change the current serving version — call {@link swap} to make it
   * live. Rejects an empty `rows` array. Reuses the `openIndex` write path.
   */
  buildVersion(rows: ChunkRow[]): BuildVersionResult;
  /**
   * Atomically make `version` (or the latest built version when omitted) the
   * current serving version. New {@link withHandle} calls read the new version;
   * readers already in flight keep the old version's handle until they release.
   */
  swap(version?: number): void;
  /** Atomically roll the current pointer back to the previous retained version. */
  rollback(): void;
  /**
   * Acquire the current version's read-only handle, run `fn`, then release it.
   * The handle stays valid across `await` boundaries inside `fn` even if a
   * `swap` happens meanwhile — a reader that started before the swap reads the
   * pre-swap version to completion (reference-counted lifetime).
   */
  withHandle<T>(fn: (handle: IndexHandle) => T | Promise<T>): Promise<T>;
  /** The current serving version, or `null` when no version has been made current. */
  currentVersion(): number | null;
  /** The retained versions, ascending. */
  listVersions(): number[];
  /** Close every open handle. Idempotent. Version files remain on disk. */
  close(): void;
}

/**
 * Persisted pointer file. Kept intentionally minimal; readers ignore unknown
 * fields so the schema can grow additively.
 */
interface IndexStoreManifest {
  /** The current serving version, or `null` for a fresh corpus with no versions yet. */
  current: number | null;
  /** All retained version numbers, ascending. */
  versions: number[];
  /** Vector dimension shared by every version file. */
  embeddingDim: number;
}

interface HandleEntry {
  handle: IndexHandle;
  /** Number of in-flight `withHandle` calls currently holding this version. */
  refcount: number;
}

function assertValidPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      `Invalid ${label}: expected positive integer, got ${String(value)}`,
    );
  }
}

/**
 * Parses and validates a raw `manifest.json` payload. Any structural problem —
 * bad JSON, wrong field types, a `current` pointer not present in `versions` —
 * is a {@link IndexStoreError} with code `CORRUPT_MANIFEST` rather than a silent
 * half-state.
 */
function parseManifest(raw: string): IndexStoreManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      'manifest.json must be a JSON object.',
    );
  }
  const obj = parsed as Record<string, unknown>;

  const { versions } = obj;
  if (!Array.isArray(versions) || versions.some((v) => !Number.isInteger(v) || (v as number) < 1)) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      'manifest.versions must be an array of positive integers.',
    );
  }
  const versionList = (versions as number[]).slice().sort((a, b) => a - b);

  const { current } = obj;
  if (current !== null && (typeof current !== 'number' || !Number.isInteger(current))) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      'manifest.current must be an integer or null.',
    );
  }
  if (current !== null && !versionList.includes(current)) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      `manifest.current (${current}) is not present in manifest.versions.`,
    );
  }

  const { embeddingDim } = obj;
  if (typeof embeddingDim !== 'number' || !Number.isInteger(embeddingDim) || embeddingDim < 1) {
    throw new IndexStoreError(
      INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST,
      'manifest.embeddingDim must be a positive integer.',
    );
  }

  return { current, versions: versionList, embeddingDim };
}

/**
 * Opens (or initializes) a versioned index store rooted at `corpusDir`.
 *
 * When a `manifest.json` already exists its recorded `embeddingDim` is
 * authoritative; passing a conflicting `opts.embeddingDim` throws. A fresh
 * corpus writes no files until the first `buildVersion` / `swap`.
 *
 * @throws {IndexStoreError} `CORRUPT_MANIFEST` when an existing manifest is
 *   malformed, or `EMBEDDING_DIM_CONFLICT` when `opts.embeddingDim` disagrees
 *   with the persisted dimension.
 */
export function openIndexStore(corpusDir: string, opts: IndexStoreOptions = {}): IndexStore {
  const keepVersions = opts.keepVersions ?? DEFAULT_KEEP_VERSIONS;
  assertValidPositiveInteger(keepVersions, 'keepVersions');

  mkdirSync(corpusDir, { recursive: true });

  const manifestPath = join(corpusDir, MANIFEST_FILENAME);
  const manifestTmpPath = join(corpusDir, MANIFEST_TMP_FILENAME);

  const versionPath = (version: number): string => join(corpusDir, `v${version}.db`);

  let manifest: IndexStoreManifest;
  let rawManifest: string | undefined;
  try {
    rawManifest = readFileSync(manifestPath, 'utf8');
  } catch {
    rawManifest = undefined; // fresh corpus — no manifest yet
  }

  if (rawManifest !== undefined) {
    manifest = parseManifest(rawManifest);
    if (opts.embeddingDim !== undefined && opts.embeddingDim !== manifest.embeddingDim) {
      throw new IndexStoreError(
        INDEX_STORE_ERROR_CODES.EMBEDDING_DIM_CONFLICT,
        `embeddingDim ${opts.embeddingDim} conflicts with the existing manifest dimension ${manifest.embeddingDim}.`,
      );
    }
  } else {
    const embeddingDim = opts.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
    assertValidPositiveInteger(embeddingDim, 'embeddingDim');
    manifest = { current: null, versions: [], embeddingDim };
  }

  const { embeddingDim } = manifest;

  /** Open read-only handles, keyed by version, plus per-version reference counts. */
  const handles = new Map<number, HandleEntry>();
  /**
   * Versions already dropped from the manifest whose files must NOT be deleted
   * yet because a reader still holds them. The physical unlink is deferred to
   * the moment the last reader releases the handle.
   */
  const pendingUnlink = new Set<number>();
  let closed = false;

  function assertOpen(): void {
    if (closed) {
      throw new IndexStoreError(
        INDEX_STORE_ERROR_CODES.STORE_CLOSED,
        'This index store has been closed.',
      );
    }
  }

  function maxVersion(): number | null {
    return manifest.versions.length > 0 ? Math.max(...manifest.versions) : null;
  }

  /** Largest retained version strictly below `version`, or `null` if none. */
  function previousVersion(version: number | null): number | null {
    if (version === null) return null;
    let prev: number | null = null;
    for (const v of manifest.versions) {
      if (v < version && (prev === null || v > prev)) prev = v;
    }
    return prev;
  }

  function unlinkVersionFiles(version: number): void {
    const base = versionPath(version);
    // A version is `<base>` plus the WAL/SHM sidecars created by
    // `PRAGMA journal_mode = WAL`. All three are removed together; `force`
    // tolerates any that are already absent.
    rmSync(base, { force: true });
    rmSync(`${base}-wal`, { force: true });
    rmSync(`${base}-shm`, { force: true });
  }

  function writeManifest(next: IndexStoreManifest): void {
    // Atomic pointer update: write the full manifest to a sibling temp file on
    // the same filesystem, then `rename` it over the real one. POSIX rename is
    // atomic, so a reader (or a crash) never observes a half-written manifest.
    writeFileSync(manifestTmpPath, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(manifestTmpPath, manifestPath);
    manifest = next;
  }

  function getOrOpenHandle(version: number): HandleEntry {
    let entry = handles.get(version);
    if (entry === undefined) {
      entry = { handle: openIndex(versionPath(version), { readonly: true }), refcount: 0 };
      handles.set(version, entry);
    }
    return entry;
  }

  /**
   * Close and forget a version's handle once it is neither the current serving
   * version nor held by any in-flight reader. If the version was already dropped
   * from the manifest (deferred cleanup), its files are unlinked here.
   */
  function tryRetireHandle(version: number): void {
    const entry = handles.get(version);
    if (entry === undefined) return;
    if (version === manifest.current) return; // never close the live serving handle
    if (entry.refcount > 0) return; // an in-flight reader still needs it
    entry.handle.close();
    handles.delete(version);
    if (pendingUnlink.has(version)) {
      unlinkVersionFiles(version);
      pendingUnlink.delete(version);
    }
  }

  /**
   * Prune versions outside the retention window after a swap / rollback.
   *
   * Retained: the current version, its one-step rollback target, and the
   * `keepVersions` highest-numbered versions. A pruned version whose file still
   * has an in-flight reader is dropped from the manifest but its physical files
   * are deferred (see {@link pendingUnlink}) until the reader releases.
   */
  function cleanupOldVersions(): void {
    const keep = new Set<number>();
    if (manifest.current !== null) keep.add(manifest.current);
    const rollbackTarget = previousVersion(manifest.current);
    if (rollbackTarget !== null) keep.add(rollbackTarget);
    for (const v of manifest.versions.slice().sort((a, b) => b - a).slice(0, keepVersions)) {
      keep.add(v);
    }

    const survivors: number[] = [];
    for (const v of manifest.versions) {
      if (keep.has(v)) {
        survivors.push(v);
        continue;
      }
      const entry = handles.get(v);
      if (entry !== undefined && entry.refcount > 0) {
        // In-flight reader: keep the file on disk, unlink after it releases.
        pendingUnlink.add(v);
        continue;
      }
      if (entry !== undefined) {
        entry.handle.close();
        handles.delete(v);
      }
      unlinkVersionFiles(v);
    }

    if (survivors.length !== manifest.versions.length) {
      writeManifest({ ...manifest, versions: survivors });
    }
  }

  /** Shared pointer-flip used by both {@link swap} and {@link rollback}. */
  function swapTo(target: number): void {
    if (!manifest.versions.includes(target)) {
      throw new IndexStoreError(
        INDEX_STORE_ERROR_CODES.VERSION_NOT_FOUND,
        `Version ${target} is not present in the store (have: ${manifest.versions.join(', ') || 'none'}).`,
      );
    }
    if (target === manifest.current) return; // already serving this version

    // Open the new handle BEFORE mutating any state — if the file is unreadable
    // the swap fails cleanly with the old pointer intact.
    getOrOpenHandle(target);

    const old = manifest.current;
    writeManifest({ ...manifest, current: target });
    if (old !== null) tryRetireHandle(old);
    cleanupOldVersions();
  }

  // Eagerly open the current serving handle so an unreadable current version
  // fails fast at construction time rather than on the first query.
  if (manifest.current !== null) getOrOpenHandle(manifest.current);

  return {
    buildVersion(rows: ChunkRow[]): BuildVersionResult {
      assertOpen();
      if (rows.length === 0) {
        throw new IndexStoreError(
          INDEX_STORE_ERROR_CODES.EMPTY_CORPUS,
          'buildVersion requires a non-empty rows array — refusing to build an empty index.',
        );
      }
      const version = (maxVersion() ?? 0) + 1;
      // Defensively clear any orphaned files at this path (e.g. a partial build
      // left by an earlier crash) so the fresh build starts clean.
      unlinkVersionFiles(version);

      const writer = openIndex(versionPath(version), { readonly: false, embeddingDim });
      let stats: IndexStats;
      try {
        stats = writer.indexChunks(rows);
      } catch (err) {
        writer.close();
        unlinkVersionFiles(version); // discard the partial file
        throw err;
      }
      writer.close();

      const nextVersions = [...manifest.versions, version].sort((a, b) => a - b);
      writeManifest({ ...manifest, versions: nextVersions });
      return { version, stats };
    },

    swap(version?: number): void {
      assertOpen();
      const target = version ?? maxVersion();
      if (target === null) {
        throw new IndexStoreError(
          INDEX_STORE_ERROR_CODES.VERSION_NOT_FOUND,
          'swap called but no versions have been built yet.',
        );
      }
      swapTo(target);
    },

    rollback(): void {
      assertOpen();
      const prev = previousVersion(manifest.current);
      if (prev === null) {
        throw new IndexStoreError(
          INDEX_STORE_ERROR_CODES.NO_PREVIOUS_VERSION,
          'rollback called but there is no earlier version to roll back to.',
        );
      }
      swapTo(prev);
    },

    async withHandle<T>(fn: (handle: IndexHandle) => T | Promise<T>): Promise<T> {
      assertOpen();
      const version = manifest.current;
      if (version === null) {
        throw new IndexStoreError(
          INDEX_STORE_ERROR_CODES.NO_CURRENT_VERSION,
          'withHandle called before any version was made current — build a version and swap first.',
        );
      }
      // Pin the version and bump the refcount synchronously, before any await, so
      // a swap happening while `fn` is suspended cannot pull the handle out.
      const entry = getOrOpenHandle(version);
      entry.refcount += 1;
      try {
        return await fn(entry.handle);
      } finally {
        entry.refcount -= 1;
        tryRetireHandle(version);
      }
    },

    currentVersion(): number | null {
      return manifest.current;
    },

    listVersions(): number[] {
      return [...manifest.versions];
    },

    close(): void {
      if (closed) return;
      closed = true;
      for (const entry of handles.values()) entry.handle.close();
      handles.clear();
      for (const version of pendingUnlink) unlinkVersionFiles(version);
      pendingUnlink.clear();
    },
  };
}
