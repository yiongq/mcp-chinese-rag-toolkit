import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSchema } from '../../../src/rag/schema.js';

describe('buildSchema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    sqliteVec.load(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates docs / docs_fts / docs_vec / meta tables in sqlite_master', () => {
    buildSchema(db);
    const names = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')",
      )
      .all()
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['docs', 'docs_fts', 'docs_vec', 'meta']));
  });

  it('enables WAL journal mode on a file-backed DB (:memory: ignores WAL by design)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-schema-'));
    const filePath = join(dir, 'schema.db');
    const fileDb = new Database(filePath);
    sqliteVec.load(fileDb);
    try {
      buildSchema(fileDb);
      const mode = fileDb.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      fileDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes embedding_dim=1024 by default and respects an override', () => {
    buildSchema(db);
    const defaultDim = db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('embedding_dim');
    expect(defaultDim?.value).toBe('1024');

    const db2 = new Database(':memory:');
    sqliteVec.load(db2);
    buildSchema(db2, { embeddingDim: 768 });
    const customDim = db2
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('embedding_dim');
    expect(customDim?.value).toBe('768');
    db2.close();
  });

  it('is idempotent — two consecutive calls do not throw', () => {
    expect(() => {
      buildSchema(db);
      buildSchema(db);
    }).not.toThrow();
  });

  it('preserves the existing index_version on a second call (avoids cache drift)', () => {
    buildSchema(db, { indexVersion: 'first-version' });
    const first = db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('index_version');
    expect(first?.value).toBe('first-version');

    buildSchema(db, { indexVersion: 'second-version' });
    const second = db
      .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
      .get('index_version');
    expect(second?.value).toBe('first-version');
  });

  it('rejects invalid embeddingDim values fail-fast', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 100_000]) {
      expect(() => {
        const fresh = new Database(':memory:');
        sqliteVec.load(fresh);
        try {
          buildSchema(fresh, { embeddingDim: bad });
        } finally {
          fresh.close();
        }
      }).toThrow(/Invalid embeddingDim/);
    }
  });

  it('throws when reopening with a different embeddingDim (docs_vec is DDL-locked)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rag-schema-dim-'));
    const filePath = join(dir, 'dim.db');
    const first = new Database(filePath);
    sqliteVec.load(first);
    try {
      buildSchema(first, { embeddingDim: 1024 });
      first.close();

      const second = new Database(filePath);
      sqliteVec.load(second);
      try {
        expect(() => buildSchema(second, { embeddingDim: 768 })).toThrow(/embeddingDim mismatch/);
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes empty-string placeholders for embedding_model and tokenizer_version', () => {
    buildSchema(db);
    const rows = db
      .prepare<[], { key: string; value: string }>(
        "SELECT key, value FROM meta WHERE key IN ('embedding_model', 'tokenizer_version')",
      )
      .all();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.embedding_model).toBe('');
    expect(byKey.tokenizer_version).toBe('');
  });
});
