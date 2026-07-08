// ---------------------------------------------------------------------------
// Entity / relation normalization — the deterministic identity strategy that
// makes repeated extraction idempotent (no duplicate nodes for surface variants
// of the same entity).
// ---------------------------------------------------------------------------

/**
 * Normalize an entity name into its canonical, dedup-stable form.
 *
 * The strategy is **deterministic and string-only** — there is no model-based
 * entity disambiguation — so re-extracting the same corpus collapses surface
 * variants of one entity onto a single node. The steps, in order:
 *
 * 1. `.normalize('NFKC')` — Unicode compatibility normalization. Unifies
 *    full-width / half-width forms and compatibility characters, which is
 *    essential for CJK corpora: full-width Latin `ＡＢＣ` folds to `ABC`, and a
 *    full-width ideographic space (`　`) folds to an ASCII space so it can
 *    be collapsed in the next step.
 * 2. Collapse every run of whitespace to a single ASCII space (`/\s+/g` → `' '`),
 *    so leading / trailing / doubled spacing never forks a node.
 * 3. Strip any residual (non-whitespace) C0/C1 control characters (`\p{Cc}`, e.g.
 *    the unit separator U+001F). Real names never contain them; removing them
 *    guarantees no control byte can survive into a key, which is what makes the
 *    relation composite-key delimiter (see `KEY_DELIMITER`) collision-free.
 * 4. `.trim()` the ends, then `.toLowerCase()` — case-folds Latin letters (a
 *    no-op for CJK), so `HR` and `hr` share one node.
 *
 * Punctuation is intentionally preserved (stripping it is lossy for names that
 * legitimately contain it). Identity is by normalized name only; an extractor
 * `type` is a descriptive attribute, not part of the key (so a relation endpoint
 * referenced by name always resolves to the same node regardless of the type the
 * entity was tagged with elsewhere).
 */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * Normalize a free-form relation type label with the same casing / whitespace
 * rules used for names, so `Works_At` and `works_at` share a relation key. An
 * absent type normalizes to the empty string.
 */
export function normalizeRelationType(type: string | undefined): string {
  if (type === undefined) return '';
  return type
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * Field delimiter for composite relation keys. `\x1f` (ASCII Unit Separator)
 * cannot appear in a normalized name — `normalizeEntityName` / `normalizeRelationType`
 * strip every control character (including this one) — so it can never be confused
 * with content. This prevents differently-split `(source, type, target)` triples
 * from colliding onto one key.
 */
const KEY_DELIMITER = '\x1f';

/**
 * Deterministic identity key for a relation edge:
 * `norm(source)` + delimiter + `norm(type)` + delimiter + `norm(target)`.
 * Two extractions that name the same directed, typed relation between the same
 * two entities produce the same key (idempotency), while direction and type are
 * preserved (A→B ≠ B→A, `works_at` ≠ `founded`).
 */
export function relationNormalizedKey(
  source: string,
  target: string,
  type: string | undefined,
): string {
  return [
    normalizeEntityName(source),
    normalizeRelationType(type),
    normalizeEntityName(target),
  ].join(KEY_DELIMITER);
}
