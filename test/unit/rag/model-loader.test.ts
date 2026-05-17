import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { env } from '@huggingface/transformers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  configureTransformersEnv,
  ModelFileMissingError,
  ModelHashMismatchError,
  resolveCacheDir,
  verifyModelFiles,
} from '../../../src/rag/model-loader.js';
import type { ModelManifest } from '../../../src/rag/types.js';

function uniqueTmp(prefix: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(tmpdir(), `${prefix}-${id}`);
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

  it('returns the caller-provided override verbatim (no subpath appended)', () => {
    const override = uniqueTmp('rag-loader-override');
    const out = resolveCacheDir(override);
    createdDirs.push(out);
    expect(out).toBe(path.resolve(override));
    expect(out.includes('mcp-chinese-rag-toolkit')).toBe(false);
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

  it('flags byte-length mismatch before computing the hash', async () => {
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
});
