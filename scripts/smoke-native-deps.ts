/**
 * Story 2.2 — native dependency smoke test.
 *
 * Verifies that the three native / NAPI modules introduced by Story 2.2
 * (better-sqlite3, sqlite-vec, @node-rs/jieba) load successfully on the
 * current Node ABI + platform. Intended for contributor reproduction when
 * prebuilds fail; CI relies on the regular `vitest` suite for coverage.
 */
import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const db = new Database(':memory:');
sqliteVec.load(db);
db.exec('CREATE VIRTUAL TABLE t USING vec0(v float[4])');
console.log('sqlite + vec0 OK');

const jieba = Jieba.withDict(dict);
console.log('jieba:', jieba.cut('试用期管理规定', false));
db.close();
