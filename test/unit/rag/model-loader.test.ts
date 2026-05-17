import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { env } from '@huggingface/transformers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureTransformersEnv,
  ModelFileMissingError,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from '../../../src/rag/model-loader.js';
import type { ModelManifest } from '../../../src/rag/types.js';

function uniqueTmp(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${randomUUID()}`);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface FixtureManifest {
  manifest: ModelManifest;
  cacheDir: string;
  filePath: string;
  content: Buffer;
}

function makeFixture(): FixtureManifest {
  const cacheDir = uniqueTmp('rag-loader');
  const modelId = 'test-org/tiny-model';
  const relativePath = 'config.json';
  const content = Buffer.from('{"hello":"world"}', 'utf8');
  const filePath = path.join(cacheDir, modelId, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);

  const manifest: ModelManifest = {
    modelId,
    embeddingDim: 4,
    files: [
      {
        relativePath,
        sha256: sha256(content),
        bytes: content.byteLength,
      },
    ],
  };
  return { manifest, cacheDir, filePath, content };
}

describe('resolveCacheDir', () => {
  let createdDirs: string[] = [];

  afterEach(() => {
    for (const d of createdDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    createdDirs = [];
  });

  it('appends `mcp-chinese-rag-toolkit/models` to the platform cache base when no override is given', () => {
    const dir = resolveCacheDir();
    createdDirs.push(dir);
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.endsWith(path.join('mcp-chinese-rag-toolkit', 'models'))).toBe(true);
  });

  it('returns the caller-provided override verbatim (no subpath appended, no mkdir)', () => {
    const override = uniqueTmp('rag-loader-override-no-mkdir');
    const out = resolveCacheDir(override);
    // AC2: 直接返回 normalized absolute path，不创建目录
    expect(out).toBe(path.resolve(override));
    expect(out.includes('mcp-chinese-rag-toolkit')).toBe(false);
    // The override path MUST NOT have been created by resolveCacheDir.
    // (Note: don't push to createdDirs — we want to assert non-existence.)
    expect(() => {
      // Will throw with ENOENT on first .stat-equivalent call if uncreated.
      // Use fs.statSync via require to keep this test sync.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      fs.statSync(out);
    }).toThrow(/ENOENT/);
  });

  it('honours `$XDG_CACHE_HOME` before falling back to platform defaults', () => {
    const xdg = uniqueTmp('rag-loader-xdg');
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    try {
      const out = resolveCacheDir();
      createdDirs.push(xdg);
      expect(out).toBe(path.join(xdg, 'mcp-chinese-rag-toolkit', 'models'));
    } finally {
      if (previous === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previous;
    }
  });

  describe('cross-platform default base path selection (Task 4.1)', () => {
    const previousXdg = process.env.XDG_CACHE_HOME;
    const previousLocalAppData = process.env.LOCALAPPDATA;
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;

    beforeEach(() => {
      // Make sure XDG never wins inside these platform tests.
      delete process.env.XDG_CACHE_HOME;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousXdg;
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previousLocalAppData;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    });

    it('darwin: picks `~/Library/Caches/mcp-chinese-rag-toolkit/models`', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      const out = resolveCacheDir();
      createdDirs.push(out);
      expect(out.endsWith(path.join('Library', 'Caches', 'mcp-chinese-rag-toolkit', 'models'))).toBe(
        true,
      );
    });

    it('linux: picks `~/.cache/mcp-chinese-rag-toolkit/models`', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      const out = resolveCacheDir();
      createdDirs.push(out);
      expect(out.endsWith(path.join('.cache', 'mcp-chinese-rag-toolkit', 'models'))).toBe(true);
    });

    it('win32 with LOCALAPPDATA set: prefers `%LOCALAPPDATA%/mcp-chinese-rag-toolkit/models`', () => {
      const winBase = uniqueTmp('rag-loader-winappdata');
      mkdirSync(winBase, { recursive: true });
      createdDirs.push(winBase);
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      process.env.LOCALAPPDATA = winBase;
      const out = resolveCacheDir();
      expect(out).toBe(path.join(winBase, 'mcp-chinese-rag-toolkit', 'models'));
    });

    it('win32 without LOCALAPPDATA: falls back to `~/AppData/Local/mcp-chinese-rag-toolkit/models`', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      delete process.env.LOCALAPPDATA;
      const out = resolveCacheDir();
      createdDirs.push(out);
      expect(out.endsWith(path.join('AppData', 'Local', 'mcp-chinese-rag-toolkit', 'models'))).toBe(true);
    });
  });
});

describe('configureTransformersEnv', () => {
  it('writes the four toolkit-owned fields onto the global env singleton', () => {
    const dir = uniqueTmp('rag-loader-env');
    mkdirSync(dir, { recursive: true });
    try {
      configureTransformersEnv({ cacheDir: dir, allowRemoteModels: false });
      expect(env.cacheDir).toBe(dir);
      expect(env.allowRemoteModels).toBe(false);
      expect(env.allowLocalModels).toBe(true);
      expect(env.useBrowserCache).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('verifyModelFiles', () => {
  let fixture: FixtureManifest;

  beforeEach(() => {
    fixture = makeFixture();
  });

  afterEach(() => {
    rmSync(fixture.cacheDir, { recursive: true, force: true });
  });

  it('accepts an unmodified file whose contents match the manifest', async () => {
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: true }),
    ).resolves.toBeUndefined();
  });

  it('throws ModelHashMismatchError when a single byte differs', async () => {
    writeFileSync(fixture.filePath, Buffer.from('{"hello":"WORLD"}', 'utf8'));
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: true }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('flags byte-length mismatch before computing the hash (strict mode)', async () => {
    writeFileSync(fixture.filePath, Buffer.from('{"hello":"world!!"}', 'utf8'));
    let caught: unknown;
    try {
      await verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: true });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelHashMismatchError);
    expect((caught as Error).message).toMatch(/byte length/);
  });

  it('deletes partial-download files in non-strict mode (size mismatch → recover, not brick)', async () => {
    // Story 2.3 H10: a previously interrupted download leaves a truncated
    // file. Non-strict pre-load verify should clear it so the upcoming
    // pipeline call can redownload — NOT throw a permanent ModelHashMismatchError.
    writeFileSync(fixture.filePath, Buffer.from('{"hello":"world!!"}', 'utf8'));
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: false }),
    ).resolves.toBeUndefined();
    // File should now be removed so transformers.js redownloads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    expect(fs.existsSync(fixture.filePath)).toBe(false);
  });

  it('treats a missing file as recoverable when strict is false', async () => {
    rmSync(fixture.filePath);
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: false }),
    ).resolves.toBeUndefined();
  });

  it('raises ModelFileMissingError under strict mode when a file is absent', async () => {
    rmSync(fixture.filePath);
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: true }),
    ).rejects.toBeInstanceOf(ModelFileMissingError);
  });

  it('rejects manifests containing path-traversal entries', async () => {
    const evilManifest: ModelManifest = {
      modelId: fixture.manifest.modelId,
      embeddingDim: 4,
      files: [
        {
          relativePath: '../escape.json',
          sha256: '0'.repeat(64),
          bytes: 1,
        },
      ],
    };
    await expect(
      verifyModelFiles(fixture.cacheDir, evilManifest, { strict: false }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('rejects manifests containing absolute paths', async () => {
    const evilManifest: ModelManifest = {
      modelId: fixture.manifest.modelId,
      embeddingDim: 4,
      files: [
        {
          relativePath: '/etc/passwd',
          sha256: '0'.repeat(64),
          bytes: 1,
        },
      ],
    };
    await expect(
      verifyModelFiles(fixture.cacheDir, evilManifest, { strict: false }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('rejects manifests containing backslash (Windows-style) regardless of host platform', async () => {
    const evilManifest: ModelManifest = {
      modelId: fixture.manifest.modelId,
      embeddingDim: 4,
      files: [
        {
          relativePath: 'onnx\\model.onnx',
          sha256: '0'.repeat(64),
          bytes: 1,
        },
      ],
    };
    await expect(
      verifyModelFiles(fixture.cacheDir, evilManifest, { strict: false }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('rejects manifests containing `.` or empty segments', async () => {
    const evilManifest: ModelManifest = {
      modelId: fixture.manifest.modelId,
      embeddingDim: 4,
      files: [
        {
          relativePath: 'onnx/./model.onnx',
          sha256: '0'.repeat(64),
          bytes: 1,
        },
      ],
    };
    await expect(
      verifyModelFiles(fixture.cacheDir, evilManifest, { strict: false }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('rejects symlinks inside the cache directory (Story 2.3 H4 — TOCTOU / symlink attack guard)', async () => {
    // Replace the regular file fixture with a symlink to itself's parent
    // dir's `config.json` copy, then verify that lstat-based detection trips.
    const targetPath = path.join(fixture.cacheDir, 'real-target.json');
    writeFileSync(targetPath, fixture.content);
    rmSync(fixture.filePath);
    symlinkSync(targetPath, fixture.filePath);
    await expect(
      verifyModelFiles(fixture.cacheDir, fixture.manifest, { strict: true }),
    ).rejects.toBeInstanceOf(ModelHashMismatchError);
  });
});
