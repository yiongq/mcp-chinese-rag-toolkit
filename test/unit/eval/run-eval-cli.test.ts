import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../../bin/run-eval.js';

describe('run-eval parseArgs', () => {
  it('returns the defaults when no flags supplied', () => {
    expect(parseArgs([])).toEqual({ evalSetPath: 'eval/eval-set.yml', outDir: 'eval-results' });
  });

  it('honours `--eval-set <path>` form', () => {
    expect(parseArgs(['--eval-set', 'custom/eval.yml'])).toEqual({
      evalSetPath: 'custom/eval.yml',
      outDir: 'eval-results',
    });
  });

  it('honours `--out-dir <path>` form', () => {
    expect(parseArgs(['--out-dir', 'tmp-results'])).toEqual({
      evalSetPath: 'eval/eval-set.yml',
      outDir: 'tmp-results',
    });
  });

  it('combines both flags in either order', () => {
    expect(parseArgs(['--out-dir', 'a', '--eval-set', 'b.yml'])).toEqual({
      evalSetPath: 'b.yml',
      outDir: 'a',
    });
  });

  it('throws when a flag is missing its value', () => {
    expect(() => parseArgs(['--eval-set'])).toThrow(/--eval-set requires a value/);
    expect(() => parseArgs(['--eval-set', '--out-dir', 'x'])).toThrow(
      /--eval-set requires a value/,
    );
  });

  it('throws on unknown arguments', () => {
    expect(() => parseArgs(['--mystery'])).toThrow(/unknown argument --mystery/);
  });
});
