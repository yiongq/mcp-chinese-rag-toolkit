import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { lstat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { env } from '@huggingface/transformers';

import type { ModelManifest } from './types.js';

/**
 * Thrown when a cached model file's SHA-256 (or pre-flight byte size) does
 * not match the pinned manifest. Catch with
 * `err instanceof ModelHashMismatchError` or
 * `err.name === 'ModelHashMismatchError'` (the latter survives ESM/CJS
 * boundary duplication).
 */
export class ModelHashMismatchError extends Error {
  override readonly name = 'ModelHashMismatchError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown by `verifyModelFiles({ strict: true })` when a pinned file is
 * absent from the cache directory. The non-strict pass (used pre-download)
 * does NOT raise this error — it tolerates missing files so transformers.js
 * can pull them on first load.
 */
export class ModelFileMissingError extends Error {
  override readonly name = 'ModelFileMissingError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

const CACHE_SUBPATH = path.join('mcp-chinese-rag-toolkit', 'models');

/**
 * Resolve the toolkit's per-user model cache directory.
 *
 * - `override` (when provided) is returned as a normalized absolute path —
 *   the caller owns the full sub-tree, we do NOT append the toolkit subpath.
 * - Otherwise picks the platform-native cache root, preferring
 *   `$XDG_CACHE_HOME` everywhere so monorepo CI runners and containerised
 *   dev environments share a single override surface.
 *
 * The returned directory is lazily created with `recursive: true` so
 * downstream `pipeline()` calls can write straight in.
 */
export function resolveCacheDir(override?: string): string {
  if (override !== undefined && override !== '') {
    // Caller owns the override sub-tree — do NOT mkdir (AC2: 直接返回 normalized absolute path，不创建目录).
    return path.resolve(override);
  }

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
  ensureDirSync(dir);
  return dir;
}

/**
 * Apply `@huggingface/transformers` global `env` settings the toolkit cares
 * about, without overwriting unrelated fields users may have set in their
 * own bootstrap code. `env` is a module-level singleton — last write wins —
 * so we centralise toolkit-owned writes in this one call site.
 */
export function configureTransformersEnv(opts: {
  cacheDir: string;
  allowRemoteModels: boolean;
}): void {
  env.cacheDir = opts.cacheDir;
  env.allowRemoteModels = opts.allowRemoteModels;
  env.allowLocalModels = true;
  // Node environments must never hit the in-browser cache adaptor.
  env.useBrowserCache = false;
}

interface VerifyOptions {
  /**
   * When true, missing files raise `ModelFileMissingError`. When false
   * (default), missing files are silently skipped — used for the pre-load
   * opportunistic pass before transformers.js downloads the model.
   */
  strict?: boolean;
}

/**
 * Verify that the cached files under `<cacheDir>/<manifest.modelId>/...`
 * match the pinned hashes byte-for-byte.
 *
 * Sequential streaming hash (one file at a time) keeps memory peak bounded
 * — model.onnx alone is ~600 MB; parallel hashing would risk OOM on
 * resource-constrained CI runners.
 */
export async function verifyModelFiles(
  cacheDir: string,
  manifest: ModelManifest,
  opts?: VerifyOptions,
): Promise<void> {
  const strict = opts?.strict ?? false;

  for (const entry of manifest.files) {
    assertSafeRelativePath(entry.relativePath);
    const absPath = path.join(cacheDir, manifest.modelId, entry.relativePath);

    // lstat (not stat) so symlinks under the cache directory are detected
    // rather than silently followed — the cache dir is treated as untrusted
    // input; an attacker (or a buggy migration) replacing a pinned file with
    // a symlink to an arbitrary system file would otherwise pass verification
    // while loading bytes from somewhere else entirely.
    let fileStat: Awaited<ReturnType<typeof lstat>>;
    try {
      fileStat = await lstat(absPath);
    } catch (err) {
      if (isErrnoNotFound(err)) {
        // `optional` files (e.g. special_tokens_map.json) are not downloaded by
        // transformers.js when redundant; a missing one is not a tamper signal.
        if (strict && !entry.optional) {
          throw new ModelFileMissingError(`Model file missing: ${entry.relativePath}`, {
            file: entry.relativePath,
            expected: entry.sha256,
            path: absPath,
          });
        }
        continue;
      }
      throw err;
    }

    if (fileStat.isSymbolicLink()) {
      throw new ModelHashMismatchError(
        `Model file rejected: ${entry.relativePath} is a symlink; cache directory must contain only regular files`,
        {
          file: entry.relativePath,
          expected: entry.sha256,
          actual: '<symlink>',
        },
      );
    }

    if (fileStat.size !== entry.bytes) {
      // In non-strict (pre-load opportunistic) mode a wrong byte length is most
      // commonly a partial download from a previous interrupted run, not a
      // tamper signal. Delete the stale artefact so transformers.js can refetch
      // on the upcoming pipeline call — this avoids permanently bricking the
      // cache after a network hiccup.
      if (!strict) {
        await unlink(absPath).catch(() => {
          /* best-effort; if delete fails, post-load strict pass will surface it */
        });
        continue;
      }
      throw new ModelHashMismatchError(
        `Model file byte length mismatch for ${entry.relativePath}: expected ${entry.bytes}, got ${fileStat.size}`,
        {
          file: entry.relativePath,
          expected: entry.sha256,
          actual: '<not-hashed>',
          bytes: fileStat.size,
        },
      );
    }

    const actualSha = await streamingSha256(absPath);
    if (actualSha !== entry.sha256) {
      throw new ModelHashMismatchError(`Model file SHA-256 mismatch for ${entry.relativePath}`, {
        file: entry.relativePath,
        expected: entry.sha256,
        actual: actualSha,
        bytes: fileStat.size,
      });
    }
  }
}

function assertSafeRelativePath(p: string): void {
  if (p === '') {
    throw new ModelHashMismatchError(`Manifest entry has an empty relativePath`);
  }
  if (path.isAbsolute(p)) {
    throw new ModelHashMismatchError(
      `Manifest entry rejected: relativePath must not be absolute (${p})`,
    );
  }
  // Reject backslash explicitly regardless of host platform. On POSIX the
  // split-on-`[\\/]` regex would happen to catch a `\` segment, but
  // `path.join` on POSIX keeps the literal `\` (breaking lookup) while on
  // Windows it normalises it (passing) — same code, divergent behaviour. Make
  // the rejection explicit so the manifest authoring contract is single-source.
  if (p.includes('\\')) {
    throw new ModelHashMismatchError(
      `Manifest entry rejected: relativePath must not contain backslash (${p})`,
    );
  }
  const segments = p.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ModelHashMismatchError(
        `Manifest entry rejected: relativePath must not contain empty, '.' or '..' segments (${p})`,
      );
    }
  }
  // Reject NUL and ASCII control characters (matches Story 2.2 fts-tokenizer guard).
  for (let i = 0; i < p.length; i += 1) {
    const code = p.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new ModelHashMismatchError(
        `Manifest entry rejected: relativePath contains control character`,
      );
    }
  }
}

async function streamingSha256(absPath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function isErrnoNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}

function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
