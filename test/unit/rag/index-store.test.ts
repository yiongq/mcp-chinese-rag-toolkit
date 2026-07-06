import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openIndexStore as openIndexStoreFromRoot } from '../../../src/index.js';
import {
  INDEX_STORE_ERROR_CODES,
  IndexStoreError,
  openIndexStore,
} from '../../../src/rag/index-store.js';
import { openIndexStore as openIndexStoreFromRagBarrel } from '../../../src/rag/index.js';
import type { ChunkRow, IndexHandle } from '../../../src/rag/types.js';

const DIM = 1024;

function makeEmbedding(seed: number, dim = DIM): Float32Array {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    arr[i] = Math.sin(seed * 0.13 + i * 0.0007) * 0.5;
  }
  return arr;
}

const SAMPLES = [
  '新员工试用期为三个月,期满后人事部门启动转正评估。',
  '请假申请需在系统提交并由直属上级审批通过。',
  '员工享有法定假日、年假与病假等带薪假期。',
  '试用期管理规定明确了培训目标与考核标准。',
  '差旅报销流程要求保留原始凭证并填写电子表单。',
];

/** A batch of `n` fixture rows; `n` is recoverable later via {@link docCount}. */
function makeFixtureChunks(n: number, dim = DIM): ChunkRow[] {
  return Array.from({ length: n }, (_, i) => ({
    chunk: {
      content: `${SAMPLES[i % SAMPLES.length]}（条目 ${i + 1}）`,
      source: 'fixture.md',
      page: (i % 7) + 1,
      section: `第${(i % 3) + 1}章 > ${(i % 5) + 1}.${(i % 4) + 1}`,
    },
    embedding: makeEmbedding(i, dim),
  }));
}

/** Row count of the version behind a handle — used to tell versions apart. */
function docCount(handle: IndexHandle): number {
  return handle.db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM docs').get()?.c ?? -1;
}

interface RawManifest {
  current: number | null;
  versions: number[];
  embeddingDim: number;
}

function readManifest(dir: string): RawManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RawManifest;
}

describe('openIndexStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rag-index-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('barrel reachability (both hops export the same symbol)', () => {
    it('resolves openIndexStore / IndexStoreError through the rag barrel and the package root', () => {
      expect(openIndexStoreFromRagBarrel).toBe(openIndexStore);
      expect(openIndexStoreFromRoot).toBe(openIndexStore);
    });
  });

  describe('buildVersion (AC1)', () => {
    it('writes v1.db and registers it in the manifest WITHOUT changing the current pointer', () => {
      const store = openIndexStore(dir);
      try {
        const res = store.buildVersion(makeFixtureChunks(4));
        expect(res.version).toBe(1);
        expect(res.stats.inserted).toBe(4);
        expect(existsSync(join(dir, 'v1.db'))).toBe(true);
        expect(store.listVersions()).toEqual([1]);
        // build is decoupled from swap: the pointer stays unset until a swap.
        expect(store.currentVersion()).toBe(null);
      } finally {
        store.close();
      }
    });

    it('assigns monotonically increasing version numbers across builds', () => {
      const store = openIndexStore(dir);
      try {
        expect(store.buildVersion(makeFixtureChunks(3)).version).toBe(1);
        expect(store.buildVersion(makeFixtureChunks(4)).version).toBe(2);
        expect(store.buildVersion(makeFixtureChunks(5)).version).toBe(3);
        expect(store.listVersions()).toEqual([1, 2, 3]);
      } finally {
        store.close();
      }
    });
  });

  describe('swap (AC1 / AC4 atomicity)', () => {
    it('flips the current pointer to the latest version and persists it atomically', () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        store.buildVersion(makeFixtureChunks(5));
        expect(store.currentVersion()).toBe(null);

        store.swap(); // no argument → latest built version
        expect(store.currentVersion()).toBe(2);

        const manifest = readManifest(dir);
        expect(manifest.current).toBe(2);
        expect(manifest.versions).toEqual([1, 2]);
        expect(manifest.embeddingDim).toBe(DIM);
        // Atomic write leaves no half-written temp file behind.
        expect(existsSync(join(dir, 'manifest.json.tmp'))).toBe(false);
      } finally {
        store.close();
      }
    });

    it('serves the swapped-to version through withHandle', async () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);
        expect(await store.withHandle((h) => docCount(h))).toBe(3);

        store.buildVersion(makeFixtureChunks(7));
        store.swap(2);
        expect(await store.withHandle((h) => docCount(h))).toBe(7);
      } finally {
        store.close();
      }
    });

    it('rejects swapping to a version that was never built', () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        expect(() => store.swap(99)).toThrow(IndexStoreError);
        expect(() => store.swap(99)).toThrow(/not present/);
        try {
          store.swap(99);
        } catch (err) {
          expect((err as IndexStoreError).code).toBe(INDEX_STORE_ERROR_CODES.VERSION_NOT_FOUND);
        }
      } finally {
        store.close();
      }
    });
  });

  describe('concurrent hot-swap semantics (AC2)', () => {
    it('keeps an in-flight reader on the old version across a swap, then closes it on release', async () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3)); // v1 → 3 rows
        store.swap(1);
        store.buildVersion(makeFixtureChunks(7)); // v2 → 7 rows (built, not yet live)

        let releaseGate!: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });

        let capturedHandle: IndexHandle | undefined;
        const observed: { before?: number; after?: number; openDuring?: boolean } = {};

        const oldReader = store.withHandle(async (h) => {
          capturedHandle = h;
          observed.before = docCount(h); // reads v1 → 3
          await gate; // suspend while still holding the v1 handle
          observed.after = docCount(h); // still v1 → 3, even though a swap happened
          observed.openDuring = h.db.open;
          return observed.after;
        });

        // The synchronous prefix of the withHandle body has already run
        // (refcount = 1, parked at `await gate`). Swap while it is suspended.
        await Promise.resolve();
        store.swap(2);

        // A fresh reader immediately observes the new version.
        expect(await store.withHandle((h) => docCount(h))).toBe(7);

        // The parked reader still reads the pre-swap version to completion.
        releaseGate();
        expect(await oldReader).toBe(3);
        expect(observed.before).toBe(3);
        expect(observed.after).toBe(3);
        expect(observed.openDuring).toBe(true);

        // Once the last in-flight reader releases it, the old handle is closed.
        expect(capturedHandle?.db.open).toBe(false);
      } finally {
        store.close();
      }
    });

    it('does not interrupt an in-flight reader when close() races the query, closing it on release', async () => {
      const store = openIndexStore(dir);
      store.buildVersion(makeFixtureChunks(5)); // v1 → 5 rows
      store.swap(1);

      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      let capturedHandle: IndexHandle | undefined;
      const observed: { rows?: number; openDuringClose?: boolean } = {};

      const reader = store.withHandle(async (h) => {
        capturedHandle = h;
        await gate; // suspend while still holding the v1 handle
        observed.openDuringClose = h.db.open; // still open despite the close() below
        observed.rows = docCount(h); // reads v1 to completion → 5
        return observed.rows;
      });

      // Let the synchronous prefix run (refcount = 1, parked at the gate), then
      // tear the store down while the query is still in flight.
      await Promise.resolve();
      store.close();
      expect(capturedHandle?.db.open).toBe(true); // close() left the held handle open

      releaseGate();
      expect(await reader).toBe(5); // the query read to completion, uninterrupted
      expect(observed.openDuringClose).toBe(true);
      expect(observed.rows).toBe(5);

      // Once the reader released it, close()'s deferred teardown finished the job.
      expect(capturedHandle?.db.open).toBe(false);
    });

    it('throws NO_CURRENT_VERSION when withHandle is called before any swap', async () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        await expect(store.withHandle(async () => 1)).rejects.toMatchObject({
          code: INDEX_STORE_ERROR_CODES.NO_CURRENT_VERSION,
        });
      } finally {
        store.close();
      }
    });
  });

  describe('rollback (AC3)', () => {
    it('rolls the current pointer back one version and persists it', async () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);
        store.buildVersion(makeFixtureChunks(7));
        store.swap(2);
        expect(store.currentVersion()).toBe(2);

        store.rollback();
        expect(store.currentVersion()).toBe(1);
        expect(readManifest(dir).current).toBe(1);
        expect(await store.withHandle((h) => docCount(h))).toBe(3);
      } finally {
        store.close();
      }
    });

    it('rejects rollback when there is no earlier version', () => {
      const store = openIndexStore(dir);
      try {
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);
        expect(() => store.rollback()).toThrow(IndexStoreError);
        try {
          store.rollback();
        } catch (err) {
          expect((err as IndexStoreError).code).toBe(
            INDEX_STORE_ERROR_CODES.NO_PREVIOUS_VERSION,
          );
        }
      } finally {
        store.close();
      }
    });
  });

  describe('version retention + cleanup (AC3)', () => {
    it('retains only the K most recent versions and deletes older .db + WAL/SHM sidecars', () => {
      const store = openIndexStore(dir, { keepVersions: 2 });
      try {
        for (let v = 1; v <= 4; v += 1) {
          store.buildVersion(makeFixtureChunks(v + 2));
          store.swap(v);
        }
        expect(store.currentVersion()).toBe(4);
        expect(store.listVersions()).toEqual([3, 4]);

        expect(existsSync(join(dir, 'v1.db'))).toBe(false);
        expect(existsSync(join(dir, 'v1.db-wal'))).toBe(false);
        expect(existsSync(join(dir, 'v1.db-shm'))).toBe(false);
        expect(existsSync(join(dir, 'v2.db'))).toBe(false);
        expect(existsSync(join(dir, 'v3.db'))).toBe(true);
        expect(existsSync(join(dir, 'v4.db'))).toBe(true);
      } finally {
        store.close();
      }
    });

    it('never prunes the current version or its rollback target even when keepVersions is 1', () => {
      const store = openIndexStore(dir, { keepVersions: 1 });
      try {
        for (const rows of [3, 7, 5]) {
          const { version } = store.buildVersion(makeFixtureChunks(rows));
          store.swap(version);
        }
        expect(store.currentVersion()).toBe(3);
        // current (3) + its rollback target (2) both survive despite K = 1.
        expect(store.listVersions()).toEqual([2, 3]);
        expect(existsSync(join(dir, 'v1.db'))).toBe(false);
        expect(existsSync(join(dir, 'v2.db'))).toBe(true);
        expect(existsSync(join(dir, 'v3.db'))).toBe(true);

        // The retained rollback target is actually usable.
        store.rollback();
        expect(store.currentVersion()).toBe(2);
      } finally {
        store.close();
      }
    });

    it('defers deleting a version whose reader is still in flight, then unlinks on release', async () => {
      const store = openIndexStore(dir, { keepVersions: 1 });
      try {
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);

        let releaseGate!: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        const reader = store.withHandle(async (h) => {
          await gate;
          return docCount(h);
        });
        await Promise.resolve();

        // Advance the pointer past v1's retention window while its reader holds it.
        store.buildVersion(makeFixtureChunks(7));
        store.swap(2);
        store.buildVersion(makeFixtureChunks(5));
        store.swap(3);

        // v1 is dropped from the manifest, but its file must NOT be deleted yet.
        expect(store.listVersions()).not.toContain(1);
        expect(existsSync(join(dir, 'v1.db'))).toBe(true);

        releaseGate();
        expect(await reader).toBe(3);

        // The deferred physical delete fires once the reader releases the handle.
        expect(existsSync(join(dir, 'v1.db'))).toBe(false);
      } finally {
        store.close();
      }
    });
  });

  describe('boundary + error semantics (AC4)', () => {
    it('refuses to build a version from an empty rows array and writes nothing', () => {
      const store = openIndexStore(dir);
      try {
        expect(() => store.buildVersion([])).toThrow(IndexStoreError);
        try {
          store.buildVersion([]);
        } catch (err) {
          expect((err as IndexStoreError).code).toBe(INDEX_STORE_ERROR_CODES.EMPTY_CORPUS);
        }
        expect(store.listVersions()).toEqual([]);
        expect(existsSync(join(dir, 'v1.db'))).toBe(false);
        expect(existsSync(join(dir, 'manifest.json'))).toBe(false);
      } finally {
        store.close();
      }
    });

    it('rejects operations after close', () => {
      const store = openIndexStore(dir);
      store.close();
      expect(() => store.buildVersion(makeFixtureChunks(3))).toThrow(IndexStoreError);
      try {
        store.buildVersion(makeFixtureChunks(1));
      } catch (err) {
        expect((err as IndexStoreError).code).toBe(INDEX_STORE_ERROR_CODES.STORE_CLOSED);
      }
    });

    it('keeps embeddingDim consistent across versions and rejects a conflicting reopen', () => {
      {
        const store = openIndexStore(dir, { embeddingDim: DIM });
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);
        store.close();
      }
      expect(() => openIndexStore(dir, { embeddingDim: 768 })).toThrow(IndexStoreError);
      try {
        openIndexStore(dir, { embeddingDim: 768 });
      } catch (err) {
        expect((err as IndexStoreError).code).toBe(
          INDEX_STORE_ERROR_CODES.EMBEDDING_DIM_CONFLICT,
        );
      }
    });

    it('rejects a corrupt manifest deterministically', () => {
      const store = openIndexStore(dir);
      store.buildVersion(makeFixtureChunks(3));
      store.swap(1);
      store.close();

      writeFileSync(join(dir, 'manifest.json'), '{ this is not valid json');
      expect(() => openIndexStore(dir)).toThrow(IndexStoreError);
      try {
        openIndexStore(dir);
      } catch (err) {
        expect((err as IndexStoreError).code).toBe(INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST);
      }
    });

    it('rejects a manifest whose current pointer is absent from its versions list', () => {
      const store = openIndexStore(dir);
      store.buildVersion(makeFixtureChunks(3));
      store.swap(1);
      store.close();

      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({ current: 9, versions: [1], embeddingDim: DIM }),
      );
      try {
        openIndexStore(dir);
        throw new Error('expected openIndexStore to throw');
      } catch (err) {
        expect((err as IndexStoreError).code).toBe(INDEX_STORE_ERROR_CODES.CORRUPT_MANIFEST);
      }
    });
  });

  describe('reopen / persistence (AC5 direction — additive over openIndex)', () => {
    it('reopens an existing corpus from its manifest and serves the current version', async () => {
      {
        const store = openIndexStore(dir);
        store.buildVersion(makeFixtureChunks(3));
        store.swap(1);
        store.buildVersion(makeFixtureChunks(7));
        store.swap(2);
        store.close();
      }

      const reopened = openIndexStore(dir);
      try {
        expect(reopened.currentVersion()).toBe(2);
        expect(reopened.listVersions()).toEqual([1, 2]);
        expect(await reopened.withHandle((h) => docCount(h))).toBe(7);

        // The reopened store can still roll back to the retained previous version.
        reopened.rollback();
        expect(reopened.currentVersion()).toBe(1);
        expect(await reopened.withHandle((h) => docCount(h))).toBe(3);
      } finally {
        reopened.close();
      }
    });
  });
});
