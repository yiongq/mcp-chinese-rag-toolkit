import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Document } from 'yaml';
import { isMap, isScalar, parseDocument } from 'yaml';

import type {
  EvalExpected,
  EvalQuery,
  EvalQueryResult,
  EvalRunnerOptions,
  EvalSearchResult,
  EvalSet,
  EvalSummary,
} from './types.js';

/**
 * Default Hit Rate@K / MRR@K — matches FR41 / NFR14 contract (90% Hit Rate@5).
 * Mirrors Story 2.5 reranker `DEFAULT_TOP_K = 5` for consistency.
 */
export const DEFAULT_EVAL_TOP_K = 5;

/**
 * Parse an eval-set.yml file from disk into a typed {@link EvalSet}.
 *
 * EXTRACTS `# reason: <text>` line comments preceding each query item and
 * attaches them to {@link EvalQuery.reason} — this lets the markdown report
 * surface "why this query matters" when CI flags a regression (AI Agent
 * Rule #9). An inline `reason: ...` YAML field is honoured as well and
 * takes precedence over the leading comment fallback.
 *
 * THROWS friendly errors when:
 *   - file does not exist / is empty
 *   - top-level shape is not `{ version, queries: [...] }`
 *   - any query has `expected: []` (empty)
 *   - any expected entry lacks `source`
 *   - any expected.page is not a positive integer
 *
 * Reason: a silent "use defaults" path on a broken eval set would let the CI
 * gate hide regressions; fail-fast keeps NFR14 honest (Story 2.6 教训 2).
 */
export function loadEvalSet(evalSetPath: string): EvalSet {
  // Resolve relative-to-cwd to match `pnpm test:eval` invocation expectations.
  const absPath = path.resolve(process.cwd(), evalSetPath);
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `loadEvalSet: failed to read ${absPath}: ${err instanceof Error ? err.message : String(err)}. ` +
        'Ensure the eval set file exists; default location is `eval/eval-set.yml` relative to package root.',
    );
  }
  if (raw.trim().length === 0) {
    throw new Error(
      `loadEvalSet: ${absPath} is empty — declare at least { version, queries: [...] }`,
    );
  }

  const doc = parseDocument(raw);
  const data = doc.toJS() as unknown;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `loadEvalSet: ${absPath} top-level must be a mapping with { version, queries }`,
    );
  }
  const obj = data as { version?: unknown; description?: unknown; queries?: unknown };
  if (typeof obj.version !== 'string' || obj.version.trim().length === 0) {
    throw new Error(`loadEvalSet: ${absPath} missing required string field 'version'`);
  }
  if (!Array.isArray(obj.queries) || obj.queries.length === 0) {
    throw new Error(`loadEvalSet: ${absPath} must declare 'queries' as a non-empty array`);
  }

  const commentReasons = extractReasonComments(doc);

  const queries: EvalQuery[] = obj.queries.map((rawItem, i) => {
    if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new Error(`loadEvalSet: queries[${i}] must be a mapping with { query, expected }`);
    }
    const item = rawItem as {
      query?: unknown;
      expected?: unknown;
      category?: unknown;
      reason?: unknown;
    };
    if (typeof item.query !== 'string' || item.query.trim().length === 0) {
      throw new Error(`loadEvalSet: queries[${i}].query must be a non-empty string`);
    }
    if (!Array.isArray(item.expected) || item.expected.length === 0) {
      throw new Error(
        `loadEvalSet: queries[${i}] (query="${item.query}") must declare ≥ 1 expected sources`,
      );
    }
    const expected: EvalExpected[] = item.expected.map((rawExp, j) => {
      if (rawExp === null || typeof rawExp !== 'object' || Array.isArray(rawExp)) {
        throw new Error(
          `loadEvalSet: queries[${i}].expected[${j}] must be a mapping { source, page? }`,
        );
      }
      const e = rawExp as { source?: unknown; page?: unknown };
      if (typeof e.source !== 'string' || e.source.trim().length === 0) {
        throw new Error(
          `loadEvalSet: queries[${i}].expected[${j}].source must be a non-empty string`,
        );
      }
      const out: EvalExpected = { source: e.source };
      if (e.page !== undefined) {
        if (!Number.isInteger(e.page) || (e.page as number) < 1) {
          throw new Error(
            `loadEvalSet: queries[${i}].expected[${j}].page must be a positive integer when present`,
          );
        }
        out.page = e.page as number;
      }
      return out;
    });
    const out: EvalQuery = { query: item.query, expected };
    if (item.category !== undefined) {
      if (typeof item.category !== 'string') {
        throw new Error(`loadEvalSet: queries[${i}].category must be a string when present`);
      }
      out.category = item.category;
    }
    // Inline `reason` wins; fall back to extracted leading `# reason:` comment.
    const inlineReason = typeof item.reason === 'string' ? item.reason : undefined;
    const commentReason = commentReasons[i];
    const reason = inlineReason ?? commentReason;
    if (reason !== undefined) out.reason = reason;
    return out;
  });

  const result: EvalSet = { version: obj.version, queries };
  if (typeof obj.description === 'string') result.description = obj.description;
  return result;
}

/** Extract the LAST `reason: <text>` line from a yaml commentBefore blob. */
function pickReasonLine(commentBefore: string | null | undefined): string | undefined {
  if (!commentBefore) return undefined;
  const lines = commentBefore.split('\n');
  let reason: string | undefined;
  for (const line of lines) {
    const m = /^\s*reason:\s*(.+?)\s*$/.exec(line);
    if (m?.[1]) reason = m[1];
  }
  return reason;
}

/**
 * Walk the YAML AST to extract `# reason: <text>` line comments preceding
 * each `queries[i]` item, returning a parallel array of reason strings (or
 * `undefined` when absent). Robust to multi-line commentBefore; we pick the
 * LAST `reason:` line specifically so the most recent author intent wins.
 *
 * Note: `yaml@^2` attaches the comment block that appears between the
 * `queries:` key and the first sequence item to the **sequence node's**
 * `commentBefore` (not item[0].commentBefore). Subsequent comments end up on
 * the following item. We honour both placements so the very first query's
 * reason is not silently dropped.
 */
function extractReasonComments(doc: Document): Array<string | undefined> {
  const out: Array<string | undefined> = [];
  const root = doc.contents;
  if (!isMap(root)) return out;
  const queriesPair = root.items.find(
    (p) => isScalar(p.key) && (p.key.value as unknown) === 'queries',
  );
  if (!queriesPair) return out;
  const queriesNode = queriesPair.value as unknown;
  if (
    !queriesNode ||
    typeof queriesNode !== 'object' ||
    !('items' in queriesNode) ||
    !Array.isArray((queriesNode as { items?: unknown[] }).items)
  ) {
    return out;
  }
  const seqCommentBefore = (queriesNode as { commentBefore?: string | null }).commentBefore;
  const items = (queriesNode as { items: Array<{ commentBefore?: string | null }> }).items;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) {
      out.push(undefined);
      continue;
    }
    const cb = i === 0 ? (item.commentBefore ?? seqCommentBefore) : item.commentBefore;
    out.push(pickReasonLine(cb));
  }
  return out;
}

/**
 * Score a single query: returns hit rank (1-indexed, undefined = miss) +
 * reciprocal rank. Pure function — easy to test without spinning up a
 * RAG pipeline.
 *
 * Semantics:
 *   - First match in topResults wins (subsequent expected matches ignored).
 *   - `strict: false` (default): source-only match.
 *   - `strict: true`: when `expected.page` is set, the result's `page` must
 *     match exactly; expected entries without a page still match on source
 *     alone.
 */
export function scoreQuery(
  query: EvalQuery,
  topResults: ReadonlyArray<{ source: string; page?: number }>,
  opts: { strict?: boolean } = {},
): { hitRank?: number; reciprocalRank: number } {
  for (let i = 0; i < topResults.length; i += 1) {
    const result = topResults[i];
    if (!result) continue;
    const matched = query.expected.some((e) => {
      if (e.source !== result.source) return false;
      if (opts.strict === true && e.page !== undefined) {
        return e.page === result.page;
      }
      return true;
    });
    if (matched) {
      const rank = i + 1;
      return { hitRank: rank, reciprocalRank: 1 / rank };
    }
  }
  return { reciprocalRank: 0 };
}

/**
 * Run an eval set against a `searchFn`, returning the full {@link EvalSummary}
 * for serialization by ci-helper.ts. Provider-injection — toolkit does NOT
 * bind to any specific MCP tool (mcp-hr Story 4.5 / mcp-modeling Story 6.7
 * each wire their own).
 *
 * Hit Rate@K is defined as `hits / totalQueries`; MRR@K is the average of
 * per-query reciprocal ranks (Manning & Raghavan §8.4 standard).
 */
export async function runEval(evalSet: EvalSet, opts: EvalRunnerOptions): Promise<EvalSummary> {
  const topK = opts.topK ?? DEFAULT_EVAL_TOP_K;
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`runEval: topK must be a positive integer, got ${String(topK)}`);
  }
  if (typeof opts.searchFn !== 'function') {
    throw new Error('runEval: opts.searchFn must be a function');
  }

  const perQuery: EvalQueryResult[] = [];
  for (const q of evalSet.queries) {
    const topResults: EvalSearchResult[] = await opts.searchFn(q.query, { topK });
    const { hitRank, reciprocalRank } = scoreQuery(q, topResults, {
      strict: opts.strict ?? false,
    });
    const row: EvalQueryResult = {
      query: q.query,
      topResults,
      reciprocalRank,
    };
    if (q.category !== undefined) row.category = q.category;
    if (q.reason !== undefined) row.reason = q.reason;
    if (hitRank !== undefined) row.hitRank = hitRank;
    perQuery.push(row);
  }

  const hits = perQuery.filter((r) => r.hitRank !== undefined).length;
  const total = perQuery.length;
  const hitRate = total === 0 ? 0 : hits / total;
  const mrr = total === 0 ? 0 : perQuery.reduce((sum, r) => sum + r.reciprocalRank, 0) / total;

  const summary: EvalSummary = {
    evalSetVersion: evalSet.version,
    timestamp: new Date().toISOString(),
    totalQueries: total,
    topK,
    hitRate,
    mrr,
    perQuery,
  };

  // Compute hitRateByCategory only when at least one query declares a category
  // (Story 2.5 教训 11: optional aggregate fields should be absent, not empty,
  // when there is nothing to aggregate).
  const hasCategory = perQuery.some((r) => r.category !== undefined);
  if (hasCategory) {
    const byCategory: Record<string, { hitRate: number; total: number; hits: number }> = {};
    for (const r of perQuery) {
      const cat = r.category ?? '(uncategorized)';
      const entry = byCategory[cat] ?? { hits: 0, total: 0, hitRate: 0 };
      entry.total += 1;
      if (r.hitRank !== undefined) entry.hits += 1;
      byCategory[cat] = entry;
    }
    for (const cat of Object.keys(byCategory)) {
      const e = byCategory[cat];
      if (e) e.hitRate = e.total === 0 ? 0 : e.hits / e.total;
    }
    summary.hitRateByCategory = byCategory;
  }

  return summary;
}
