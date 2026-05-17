import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';

/**
 * Module-level Jieba singleton — the default dictionary is ~10 MB and only
 * needs to be loaded once per process. `@node-rs/jieba` 2.x is class-based
 * (replacing the 1.x top-level `cut()` helper), so we own the instance here
 * and expose only the `tokenize()` helper. Future Story 2.7 eval may add a
 * domain dictionary via `Jieba.withDict(customDict)` — keep that off the
 * critical path for MVP.
 */
const jieba = Jieba.withDict(dict);

// Control characters and NUL bytes break FTS5's MATCH parser (and would leak
// through phrase quoting). Strip them at the entry boundary instead of trying
// to escape downstream. Stripping control chars is the whole point of this
// regex — `noControlCharactersInRegex` does not apply here.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional sanitizer
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// A token consisting entirely of punctuation / symbols / whitespace contributes
// noise to FTS5 phrase queries (jieba occasionally emits these for delimiters
// like "。", "?", "*"). They never participate in meaningful BM25 ranking.
const PUNCTUATION_ONLY_RE = /^[\s\p{P}\p{S}]+$/u;

/**
 * Tokenizes Chinese (or mixed CJK + Latin) input into a space-joined token
 * string suitable for FTS5's default `unicode61` tokenizer. The output is
 * the canonical reverse-index payload written into `docs_fts.text_tokens`
 * by {@link IndexHandle.indexChunks} and the query payload used by
 * {@link IndexHandle.ftsSearch}.
 *
 * Design notes:
 * - `cut(text, false)` disables HMM unknown-word discovery for **deterministic**
 *   indexing output (HMM bias is useful for OOV recall in query expansion,
 *   not for stable BM25 ranking).
 * - NUL bytes and ASCII control characters are stripped before tokenizing —
 *   FTS5 / better-sqlite3 binding behaviour around `\0` is platform-dependent
 *   and easier to neutralize upstream.
 * - Whitespace-only and punctuation-only tokens are dropped so phrase queries
 *   built from the output never degenerate into FTS5 parse errors.
 * - No Latin lowercase / diacritic folding: FTS5's `unicode61 remove_diacritics 1`
 *   already handles those at index/query time.
 * - No stopword filter — FTS5 BM25 IDF downweights frequent terms automatically;
 *   stopword lists would degrade stopword-only queries like "在哪里".
 */
export function tokenize(text: string): string {
  if (text.length === 0) {
    return '';
  }
  const sanitized = text.replace(CONTROL_CHAR_RE, '');
  if (sanitized.length === 0) {
    return '';
  }
  const tokens = jieba.cut(sanitized, false);
  return tokens.filter((t) => t.trim().length > 0 && !PUNCTUATION_ONLY_RE.test(t)).join(' ');
}
