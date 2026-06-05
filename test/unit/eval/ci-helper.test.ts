import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HIT_RATE_MIN,
  DEFAULT_RESULTS_DIR,
  emitGitHubActionsAnnotation,
  passesGate,
  renderMarkdownReport,
  resolveHitRateMin,
  writeArtifacts,
} from '../../../src/eval/ci-helper.js';
import type { EvalQueryResult, EvalSummary } from '../../../src/eval/types.js';

function row(over: Partial<EvalQueryResult> = {}): EvalQueryResult {
  return {
    query: 'q',
    topResults: [],
    reciprocalRank: 0,
    ...over,
  };
}

function summary(over: Partial<EvalSummary> = {}): EvalSummary {
  return {
    evalSetVersion: 'v1-test',
    timestamp: '2026-05-17T00:00:00.000Z',
    totalQueries: 3,
    topK: 5,
    hitRate: 0.6667,
    mrr: 0.5,
    perQuery: [
      row({
        query: '试用期多久',
        category: 'probation',
        reason: 'BDD anchor',
        hitRank: 1,
        reciprocalRank: 1,
        topResults: [
          { source: 'bench-fixture.md', page: 3, rerankScore: 0.92, distance: 0.31, ftsRank: 1 },
        ],
      }),
      row({
        query: '法定节假日',
        category: 'holidays',
        hitRank: 2,
        reciprocalRank: 0.5,
        topResults: [{ source: 'bench-fixture.md', page: 7, rerankScore: 0.71 }],
      }),
      row({
        query: 'not | matched',
        topResults: [],
      }),
    ],
    ...over,
  };
}

describe('writeArtifacts', () => {
  let outDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'ci-helper-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes summary.json + report.md + per-query.json side-by-side', () => {
    const out = writeArtifacts(summary(), { outDir });
    expect(statSync(out.summaryPath).isFile()).toBe(true);
    expect(statSync(out.reportPath).isFile()).toBe(true);
    expect(statSync(out.perQueryPath).isFile()).toBe(true);
    expect(out.summaryPath).toBe(path.join(outDir, 'summary.json'));
    expect(out.reportPath).toBe(path.join(outDir, 'report.md'));
    expect(out.perQueryPath).toBe(path.join(outDir, 'per-query.json'));
  });

  it('auto-creates the outDir when it does not yet exist', () => {
    const nested = path.join(outDir, 'a', 'b', 'c');
    const out = writeArtifacts(summary(), { outDir: nested });
    expect(statSync(out.summaryPath).isFile()).toBe(true);
  });

  it('round-trips summary.json verbatim', () => {
    const s = summary();
    const out = writeArtifacts(s, { outDir });
    const parsed = JSON.parse(readFileSync(out.summaryPath, 'utf8')) as EvalSummary;
    expect(parsed.evalSetVersion).toBe(s.evalSetVersion);
    expect(parsed.hitRate).toBe(s.hitRate);
    expect(parsed.perQuery).toHaveLength(s.perQuery.length);
  });

  it('per-query.json contains only the perQuery array', () => {
    const out = writeArtifacts(summary(), { outDir });
    const parsed = JSON.parse(readFileSync(out.perQueryPath, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it('appends a trailing newline to both JSON artifacts (Unix convention)', () => {
    const out = writeArtifacts(summary(), { outDir });
    expect(readFileSync(out.summaryPath, 'utf8').endsWith('\n')).toBe(true);
    expect(readFileSync(out.perQueryPath, 'utf8').endsWith('\n')).toBe(true);
  });

  it('falls back to DEFAULT_RESULTS_DIR when outDir is omitted', () => {
    process.chdir(outDir);
    const out = writeArtifacts(summary());
    // macOS resolves the symlinked tmpdir (/var → /private/var) once we chdir,
    // so compare against the realpath we land in rather than the original.
    const cwdReal = realpathSync(process.cwd());
    expect(out.summaryPath).toBe(path.join(cwdReal, DEFAULT_RESULTS_DIR, 'summary.json'));
  });
});

describe('renderMarkdownReport', () => {
  it('includes header sections for version / timestamp / hitRate / MRR', () => {
    const md = renderMarkdownReport(summary());
    expect(md).toMatch(/# RAG Eval Report/);
    expect(md).toContain('v1-test');
    expect(md).toContain('2026-05-17T00:00:00.000Z');
    expect(md).toMatch(/Hit Rate@5/);
    expect(md).toMatch(/MRR@5/);
  });

  it('escapes `|` in query text so it does not break the table', () => {
    const md = renderMarkdownReport(summary());
    expect(md).toContain('not \\| matched');
  });

  it('escapes embedded newlines in reason cells', () => {
    const s = summary({
      perQuery: [row({ query: 'q', reason: 'line1\nline2', hitRank: 1, reciprocalRank: 1 })],
      totalQueries: 1,
      hitRate: 1,
      mrr: 1,
    });
    const md = renderMarkdownReport(s);
    expect(md).not.toMatch(/line1\nline2/);
    expect(md).toContain('line1 line2');
  });

  it('renders `-` for missing rerankScore / distance / ftsRank / reason fields', () => {
    const s = summary({
      perQuery: [
        row({ query: 'q', hitRank: 1, reciprocalRank: 1, topResults: [{ source: 'a.md' }] }),
      ],
      totalQueries: 1,
      hitRate: 1,
      mrr: 1,
    });
    const md = renderMarkdownReport(s);
    // pipe-separated row should include 4 standalone `-` cells (rerank, distance, fts, reason)
    expect(md).toMatch(/\| 1 \| q \| 1 \| `a\.md` \| - \| - \| - \| - \|/);
  });

  it('highlights MISS rows with bold marker', () => {
    const md = renderMarkdownReport(summary());
    expect(md).toContain('**MISS**');
  });

  it('renders Hit Rate by Category table when provided', () => {
    const md = renderMarkdownReport(
      summary({
        hitRateByCategory: {
          'leave-policy': { hitRate: 0.75, total: 4, hits: 3 },
          training: { hitRate: 1, total: 2, hits: 2 },
        },
      }),
    );
    expect(md).toContain('## Hit Rate by Category');
    expect(md).toContain('| leave-policy | 75.00% | 3 / 4 |');
    expect(md).toContain('| training | 100.00% | 2 / 2 |');
  });

  it('omits Hit Rate by Category section when not provided', () => {
    const md = renderMarkdownReport(summary());
    expect(md).not.toContain('## Hit Rate by Category');
  });

  it('shows `-` for Top-1 Source when topResults is empty', () => {
    const s = summary({
      perQuery: [row({ query: 'orphan', topResults: [] })],
      totalQueries: 1,
      hitRate: 0,
      mrr: 0,
    });
    const md = renderMarkdownReport(s);
    expect(md).toMatch(/\| 1 \| orphan \| \*\*MISS\*\* \| - \|/);
  });

  it('escapes backticks in query / reason cells so they do not break the code span', () => {
    // Review fix M10 — Top-1 Source is wrapped in `…`, so a backtick anywhere
    // in the cell content must be escaped or the markdown table corrupts.
    const s = summary({
      perQuery: [
        row({
          query: 'tick `q`',
          reason: 'reason with `back` tick',
          hitRank: 1,
          reciprocalRank: 1,
          topResults: [{ source: 'a`b.md' }],
        }),
      ],
      totalQueries: 1,
      hitRate: 1,
      mrr: 1,
    });
    const md = renderMarkdownReport(s);
    expect(md).toContain('tick \\`q\\`');
    expect(md).toContain('reason with \\`back\\` tick');
    expect(md).toContain('`a\\`b.md`');
  });

  it('renders ERROR rows with the error message in the reason column', () => {
    // Review fix M8 — a query whose searchFn threw must be visibly distinct
    // from a clean MISS so the reviewer immediately sees "this query crashed,
    // not just missed".
    const s = summary({
      perQuery: [
        row({
          query: 'bad query',
          error: 'searchFn threw: boom',
          topResults: [],
        }),
      ],
      totalQueries: 1,
      hitRate: 0,
      mrr: 0,
    });
    const md = renderMarkdownReport(s);
    expect(md).toContain('**ERROR**');
    expect(md).toContain('searchFn threw: boom');
  });
});

describe('passesGate', () => {
  it('returns true when hitRate equals the threshold', () => {
    expect(passesGate(summary({ hitRate: 0.9 }), 0.9)).toBe(true);
  });

  it('returns false when hitRate is just below the threshold', () => {
    expect(passesGate(summary({ hitRate: 0.8999 }), 0.9)).toBe(false);
  });

  it('uses DEFAULT_HIT_RATE_MIN when no threshold supplied', () => {
    expect(passesGate(summary({ hitRate: DEFAULT_HIT_RATE_MIN }))).toBe(true);
    expect(passesGate(summary({ hitRate: DEFAULT_HIT_RATE_MIN - 0.0001 }))).toBe(false);
  });
});

describe('resolveHitRateMin', () => {
  const original = process.env.RAG_EVAL_HIT_RATE_MIN;

  afterEach(() => {
    if (original === undefined) delete process.env.RAG_EVAL_HIT_RATE_MIN;
    else process.env.RAG_EVAL_HIT_RATE_MIN = original;
  });

  it('falls back to DEFAULT_HIT_RATE_MIN when env var is unset', () => {
    delete process.env.RAG_EVAL_HIT_RATE_MIN;
    expect(resolveHitRateMin()).toBe(DEFAULT_HIT_RATE_MIN);
  });

  it('parses a valid float from explicit argument', () => {
    expect(resolveHitRateMin('0.85')).toBe(0.85);
  });

  it('parses 0 and 1 as valid edge cases', () => {
    expect(resolveHitRateMin('0')).toBe(0);
    expect(resolveHitRateMin('1')).toBe(1);
  });

  it('throws an actionable error for out-of-range value', () => {
    expect(() => resolveHitRateMin('1.5')).toThrow(/RAG_EVAL_HIT_RATE_MIN.*\[0, 1\]/);
  });

  it('throws an actionable error for non-numeric value', () => {
    expect(() => resolveHitRateMin('abc')).toThrow(/RAG_EVAL_HIT_RATE_MIN/);
  });
});

describe('emitGitHubActionsAnnotation', () => {
  const originalGha = process.env.GITHUB_ACTIONS;

  afterEach(() => {
    if (originalGha === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = originalGha;
    vi.restoreAllMocks();
  });

  it('is a no-op when GITHUB_ACTIONS env var is not "true"', () => {
    delete process.env.GITHUB_ACTIONS;
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitGitHubActionsAnnotation(summary({ hitRate: 0.5 }), 0.9);
    expect(spy).not.toHaveBeenCalled();
  });

  it('writes a `::error::` annotation on gate failure', () => {
    process.env.GITHUB_ACTIONS = 'true';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitGitHubActionsAnnotation(summary({ hitRate: 0.5 }), 0.9);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0];
    expect(typeof line === 'string' ? line : '').toMatch(/::error title=RAG Eval CI Gate Failed/);
  });

  it('writes a `::notice::` annotation on gate pass', () => {
    process.env.GITHUB_ACTIONS = 'true';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitGitHubActionsAnnotation(summary({ hitRate: 0.95 }), 0.9);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0];
    expect(typeof line === 'string' ? line : '').toMatch(/::notice title=RAG Eval Passed/);
  });
});
