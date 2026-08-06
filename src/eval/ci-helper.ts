import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { EvalSummary } from './types.js';

/**
 * Default `eval-results/` location relative to the consuming package (each
 * consumer package owns its own; the toolkit self-eval writes to
 * `eval-results/` at the package root).
 */
export const DEFAULT_RESULTS_DIR = 'eval-results';

/**
 * Default minimum Hit Rate@K (90%). Can be overridden via the
 * `RAG_EVAL_HIT_RATE_MIN` env var (parsed as float ∈ [0, 1]). Production CI
 * MUST keep the default; dev override exists only for debugging.
 */
export const DEFAULT_HIT_RATE_MIN = 0.9;

export interface WriteArtifactsOptions {
  /** Output directory (relative to process.cwd()). @default 'eval-results' */
  outDir?: string;
}

/**
 * Write summary.json / report.md / per-query.json into outDir. Creates the
 * directory if it does not exist. Atomic per-file write is NOT used — eval is
 * non-interactive batch and CI re-runs are cheap (mirrors bench's
 * straight write); partial output on crash is acceptable because the gate
 * step fails fast and the report becomes worthless either way.
 */
export function writeArtifacts(
  summary: EvalSummary,
  opts: WriteArtifactsOptions = {},
): {
  summaryPath: string;
  reportPath: string;
  perQueryPath: string;
} {
  const outDir = path.resolve(process.cwd(), opts.outDir ?? DEFAULT_RESULTS_DIR);
  mkdirSync(outDir, { recursive: true });

  const summaryPath = path.join(outDir, 'summary.json');
  const reportPath = path.join(outDir, 'report.md');
  const perQueryPath = path.join(outDir, 'per-query.json');

  // summary.json —  machine-readable artifact (consumed by future
  // dashboards / Phase 2 OTel exporter; structure stability matters).
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  // per-query.json —  verbose breakdown (rerankScore / distance / ftsRank),
  // serialised separately because it is verbose (~10-50 KB) and most PR review
  // only needs summary.md.
  writeFileSync(perQueryPath, `${JSON.stringify(summary.perQuery, null, 2)}\n`, 'utf8');

  // report.md — human-readable artifact (PR check summary / artifact preview).
  writeFileSync(reportPath, renderMarkdownReport(summary), 'utf8');

  return { summaryPath, reportPath, perQueryPath };
}

/**
 * Render the {@link EvalSummary} as GitHub-flavoured markdown. Format is
 * stable across runs to make a `diff` between PR runs informative.
 */
export function renderMarkdownReport(summary: EvalSummary): string {
  const lines: string[] = [];
  const pctHit = (summary.hitRate * 100).toFixed(2);
  const pctMrr = summary.mrr.toFixed(4);
  lines.push('# RAG Eval Report');
  lines.push('');
  lines.push(`- **Eval set version**: \`${summary.evalSetVersion}\``);
  lines.push(`- **Timestamp (UTC)**: ${summary.timestamp}`);
  lines.push(`- **Total queries**: ${summary.totalQueries}`);
  lines.push(`- **Top-K**: ${summary.topK}`);
  lines.push(`- **Hit Rate@${summary.topK}**: **${pctHit}%**`);
  lines.push(`- **MRR@${summary.topK}**: **${pctMrr}**`);
  lines.push('');

  if (summary.hitRateByCategory && Object.keys(summary.hitRateByCategory).length > 0) {
    lines.push('## Hit Rate by Category');
    lines.push('');
    lines.push('| Category | Hit Rate | Hits / Total |');
    lines.push('|---|---:|---:|');
    const categories = Object.keys(summary.hitRateByCategory).sort();
    for (const cat of categories) {
      const e = summary.hitRateByCategory[cat];
      if (!e) continue;
      const pct = (e.hitRate * 100).toFixed(2);
      lines.push(`| ${cat} | ${pct}% | ${e.hits} / ${e.total} |`);
    }
    lines.push('');
  }

  lines.push('## Per-Query Results');
  lines.push('');
  lines.push('| # | Query | Hit Rank | Top-1 Source | rerankScore | distance | ftsRank | Reason |');
  lines.push('|---:|---|---:|---|---:|---:|---:|---|');
  summary.perQuery.forEach((r, i) => {
    // Errored queries surface as `**ERROR**` in the Hit Rank column so the
    // reviewer immediately sees they did not run to completion (vs MISS,
    // which means the pipeline ran but no expected source landed in top-K).
    const hitRank =
      r.error !== undefined
        ? '**ERROR**'
        : r.hitRank !== undefined
          ? String(r.hitRank)
          : '**MISS**';
    const top1 = r.topResults[0];
    const top1Src = top1
      ? `\`${escapeMarkdown(top1.source)}${top1.page !== undefined ? `#${top1.page}` : ''}\``
      : '-';
    const rerankScore = top1?.rerankScore !== undefined ? top1.rerankScore.toFixed(4) : '-';
    const distance = top1?.distance !== undefined ? top1.distance.toFixed(4) : '-';
    const ftsRank = top1?.ftsRank !== undefined ? String(top1.ftsRank) : '-';
    const reasonOrError = r.error !== undefined ? `⚠️ ${r.error}` : r.reason;
    const reason = reasonOrError !== undefined ? escapeMarkdown(reasonOrError) : '-';
    lines.push(
      `| ${i + 1} | ${escapeMarkdown(r.query)} | ${hitRank} | ${top1Src} | ${rerankScore} | ${distance} | ${ftsRank} | ${reason} |`,
    );
  });
  lines.push('');

  return lines.join('\n');
}

/**
 * Minimal markdown-table-cell escaping. Handles the three characters that
 * would otherwise corrupt a GitHub-flavoured markdown table:
 *   - `|`     → `\|`   (column separator)
 *   - newline → ` `    (row terminator)
 *   - backtick → `\``  (code-span opener; matters because top-1 source is
 *                       wrapped in `` `...` ``, and a reason / query that
 *                       contains a backtick would otherwise break the span
 *                       and split the cell across columns)
 */
function escapeMarkdown(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/`/g, '\\`').replace(/\n/g, ' ');
}

/**
 * Read `RAG_EVAL_HIT_RATE_MIN` env var, fall back to {@link DEFAULT_HIT_RATE_MIN}.
 * Validates the parsed value is a finite float in [0, 1]; throws actionable
 * error otherwise (the error message contains the env var name so reviewers
 * see immediately which knob is wrong).
 */
export function resolveHitRateMin(envValue?: string): number {
  const raw = envValue ?? process.env.RAG_EVAL_HIT_RATE_MIN;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_HIT_RATE_MIN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(
      `resolveHitRateMin: RAG_EVAL_HIT_RATE_MIN must be a float in [0, 1], got '${raw}'`,
    );
  }
  return parsed;
}

/**
 * Read `RAG_EVAL_MRR_MIN` env var. Unlike the Hit Rate floor there is no
 * default: when the env var is unset (or blank) the MRR gate is simply not
 * enforced, keeping existing pipelines backward compatible. Validates the
 * parsed value is a finite float in [0, 1]; throws an actionable error
 * otherwise (mirrors {@link resolveHitRateMin}).
 */
export function resolveMrrMin(envValue?: string): number | undefined {
  const raw = envValue ?? process.env.RAG_EVAL_MRR_MIN;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`resolveMrrMin: RAG_EVAL_MRR_MIN must be a float in [0, 1], got '${raw}'`);
  }
  return parsed;
}

/**
 * Returns true when the eval summary meets the CI gate: hitRate ≥ threshold
 * AND — when an MRR floor is provided — mrr ≥ mrrThreshold. `mrrThreshold`
 * defaults to undefined (no MRR gate) so existing callers keep their
 * hit-rate-only behaviour.
 */
export function passesGate(
  summary: EvalSummary,
  threshold = DEFAULT_HIT_RATE_MIN,
  mrrThreshold?: number,
): boolean {
  if (summary.hitRate < threshold) return false;
  return mrrThreshold === undefined || summary.mrr >= mrrThreshold;
}

/**
 * GitHub Actions-friendly stdout writer — emits `::error::` annotation on
 * gate failure + `::notice::` on pass. Mirrors latency-harness
 * bench `::warning::` idiom for consistency. No-op outside GitHub Actions so
 * local runs do not pollute stdout. `mrrThreshold` mirrors {@link passesGate}:
 * omitted → the MRR floor is not part of the verdict.
 */
export function emitGitHubActionsAnnotation(
  summary: EvalSummary,
  threshold: number,
  mrrThreshold?: number,
): void {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const pct = (summary.hitRate * 100).toFixed(2);
  const minPct = (threshold * 100).toFixed(2);
  const failures: string[] = [];
  if (summary.hitRate < threshold) {
    failures.push(`Hit Rate@${summary.topK} = ${pct}% < ${minPct}%`);
  }
  if (mrrThreshold !== undefined && summary.mrr < mrrThreshold) {
    failures.push(`MRR@${summary.topK} = ${summary.mrr.toFixed(4)} < ${mrrThreshold.toFixed(4)}`);
  }
  if (failures.length > 0) {
    process.stdout.write(
      `::error title=RAG Eval CI Gate Failed::${failures.join('; ')}. See eval-results/report.md for per-query breakdown.\n`,
    );
  } else {
    const mrrSuffix = mrrThreshold !== undefined ? ` ≥ ${mrrThreshold.toFixed(4)}` : '';
    process.stdout.write(
      `::notice title=RAG Eval Passed::Hit Rate@${summary.topK} = ${pct}% ≥ ${minPct}%. MRR = ${summary.mrr.toFixed(4)}${mrrSuffix}.\n`,
    );
  }
}
