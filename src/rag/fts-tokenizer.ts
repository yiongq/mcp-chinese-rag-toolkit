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
 * - Whitespace-only tokens are stripped — jieba occasionally emits them and
 *   they would otherwise corrupt FTS5 phrase queries.
 * - No Latin lowercase / diacritic folding: FTS5's `unicode61 remove_diacritics 1`
 *   already handles those at index/query time.
 * - No stopword filter — FTS5 BM25 IDF downweights frequent terms automatically;
 *   stopword lists would degrade stopword-only queries like "在哪里".
 */
export function tokenize(text: string): string {
  if (text.length === 0) {
    return '';
  }
  const tokens = jieba.cut(text, false);
  return tokens.filter((t) => t.trim().length > 0).join(' ');
}
