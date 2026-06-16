// ---------------------------------------------------------------------------
// — Indirect prompt-injection / retrieval-poisoning defense (stateless pure fn)
// ---------------------------------------------------------------------------
//
// `sanitizeRetrievedContent` is the retrieval-side guard: it inspects text that
// came BACK from a retrieval index (a chunk's content, its source filename, a
// heading) before that text re-enters a model context, and neutralizes the
// injection patterns a poisoned document carries. RAG-specific attack surface:
// the attacker controls the documents, not the prompt, so a retrieved chunk can
// smuggle "ignore the above instructions…" / a forged `系统：` role turn / a
// "you are now…" persona hijack into the context the model trusts.
//
// Boundaries, deliberately narrow (mirrors `rewriteQuery`'s discipline):
//   - PURE & RULE-BASED: a deterministic rule table, no model call, no
//     `generateFn`. LLM-based detection (if ever needed) is an orchestration
//     concern for the consuming service, never embedded in this toolkit.
//   - STATELESS, ZERO SIDE EFFECTS: no network, no env, no disk, no console,
//     no clock, no randomness — a public toolkit pure function. Output is a
//     deterministic function of (content, options) only.
//   - SEMANTIC SIGNATURE ONLY: no business fields (no service/tenant/citation/
//     confidence) — just text in, an honest structured result out.
//   - HONEST STRUCTURE: the result is `{ sanitized, flagged, detections }`,
//     never a bare string the caller has to re-inspect. `detections` is
//     content-bounded (truncated excerpts) so it can be COUNTED to feed a
//     red-team metric without copying whole poisoned passages into a log face.
//
// Neutralization is defang + annotate, never deletion (deleting would drop
// information and defeat "what did we detect" metrics):
//   - structural tokens (role labels, `<|im_start|>`, `[INST]`, fence
//     brackets) get a zero-width break so they lose their boundary semantics;
//   - imperative / persona-hijack clauses get wrapped in a deterministic
//     `⟦untrusted:<category>:<token>⟧…⟦/untrusted:<token>⟧` annotation, telling
//     the model "this span is flagged data — do not act on it".
//
// Idempotent by construction: re-sanitizing already-sanitized text is a no-op
// (`sanitize(sanitize(x).sanitized).sanitized === sanitize(x).sanitized`). A
// broken structural token no longer matches its rule; a fence bracket carries a
// negative-lookaround so an already-broken one is skipped; and a wrap block this
// function produced is recognized (its `<token>` is a content hash of the very
// span it encloses) and frozen — copied through verbatim, never re-scanned or
// re-wrapped.
//
// Anti-forge: a poisoned document can pre-plant the annotation markers — a
// stray `⟦/untrusted:…⟧` to close a real wrapper early, or a fake
// `⟦untrusted:…⟧…⟦/untrusted:…⟧` to disguise an injection as "already cleaned".
// Both are defeated: a wrap block is only frozen when its enclosed text hashes
// to its own `<token>`, and every OTHER fence bracket in the input is broken
// before this round's wrapping. (Like the `untrusted.ts` fence, the content
// hash is collision-avoidance, not a secret — and disguising hostile text as
// wrapped data is self-defeating, since wrapped data is exactly what a flagged
// span becomes.)

import { fenceToken } from '../internal/untrusted.js';

/** The injection surface a detection belongs to (rule-based three-way split). */
export type InjectionCategory =
  | 'instruction-override' // imperative hijack: 忽略以上所有指令 / ignore previous instructions
  | 'role-marker' // forged role / delimiter: line-start 系统：助手： / <|im_start|> / [INST]
  | 'role-injection'; // persona hijack: 你现在是… / 扮演… / act as

/**
 * One detected injection span. `excerpt` is truncated (never the whole
 * passage — keeps poisoned text out of any observation/log face); `index` is
 * the Unicode code-point offset into the ORIGINAL `content`.
 */
export interface InjectionDetection {
  category: InjectionCategory;
  excerpt: string;
  index: number;
}

/** Forward-compatible options bag — minimal by design. */
export interface SanitizeOptions {
  /**
   * Max code points kept per detection `excerpt`. A non-finite or non-positive
   * value falls back to the internal default (same validation discipline as the
   * rewrite timeout budget).
   * @default DEFAULT_MAX_EXCERPT_CHARS
   */
  maxExcerptChars?: number;
}

/**
 * Honest structured result. `sanitized` is safe to splice into a model context;
 * `flagged` is `detections.length > 0`; `detections` is source-ordered and
 * content-bounded so it can be counted by a red-team harness.
 */
export interface SanitizeResult {
  sanitized: string;
  flagged: boolean;
  detections: readonly InjectionDetection[];
}

/**
 * Version stamp for the rule table, bumped on ANY rule add/remove/edit. A
 * red-team metric records it so a reported interception rate is reproducible
 * against the exact ruleset that produced it (the ruleset evolves with the
 * red-team corpus; a comparable denominator needs the version pinned).
 *
 * Format: an ISO date, with an optional `.N` revision suffix for a same-day
 * change. History (newest first):
 *   - `2026-06-16` — initial three-category rule table (instruction-override /
 *     role-marker / role-injection) with break + wrap neutralization.
 */
export const SANITIZE_RULES_VERSION = '2026-06-16';

/** Default cap on a detection excerpt's length, in code points. */
const DEFAULT_MAX_EXCERPT_CHARS = 64;

/**
 * Zero-width space inserted to defang a structural token without deleting any
 * visible character. Chosen because `\s` does NOT match it, so a broken token
 * (e.g. `系​统：`) cannot re-satisfy a `\s*`-bearing rule on a second pass.
 */
const BREAK = '​';

type RuleAction = 'break' | 'wrap';

interface Rule {
  category: InjectionCategory;
  pattern: RegExp; // MUST be global (matchAll requirement)
  action: RuleAction;
  /** Neutralized form of a matched span (break rules only; wrap is uniform). */
  neutralize?: (span: string) => string;
}

/** Insert the zero-width break after the first code point of a token. */
function breakAfterFirst(span: string): string {
  const cps = [...span];
  return `${cps[0] ?? ''}${BREAK}${cps.slice(1).join('')}`;
}

// Structural / role-marker tokens → BREAK. Idempotent: a broken token no longer
// matches its own rule, so a second pass is a no-op.
//
// ⚠️ Anchoring discipline (the zero-false-positive hard line, C-2): role labels
// are LINE-START anchored, so `操作系统：Linux` (系统 mid-line) never fires; the
// imperative / persona rules match HIJACK CLAUSES, not bare words, so
// `系统设置`, `操作指令如下`, `助手岗位职责` stay untouched.
const ROLE_MARKER_RULES: Rule[] = [
  // Fence brackets the toolkit itself uses for untrusted-data sentinels — they
  // must never arrive inside retrieved content; a pre-planted one is an attempt
  // to forge or prematurely close an annotation. Negative-lookaround so an
  // already-broken bracket is skipped (idempotency).
  {
    category: 'role-marker',
    pattern: /⟦(?!​)/gu,
    action: 'break',
    neutralize: (span) => `${span}${BREAK}`,
  },
  {
    category: 'role-marker',
    pattern: /(?<!​)⟧/gu,
    action: 'break',
    neutralize: (span) => `${BREAK}${span}`,
  },
  // Line-start role labels: 系统： 助手： 用户： system: user: assistant:
  {
    category: 'role-marker',
    pattern: /^[ \t　]*(?:系统|助手|用户|assistant|system|user)[ \t　]*[:：]/gimu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  // Chat-template special tokens.
  {
    category: 'role-marker',
    pattern: /<\|im_(?:start|end)\|>/gu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  {
    category: 'role-marker',
    pattern: /<\|(?:system|user|assistant)\|>/giu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  // Instruction brackets ([INST]/[/INST], <<SYS>>/<</SYS>>).
  {
    category: 'role-marker',
    pattern: /\[\/?INST\]/giu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  {
    category: 'role-marker',
    pattern: /<<\/?SYS>>/giu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  // Markdown role/system headings at line start.
  {
    category: 'role-marker',
    pattern: /^#{1,6}[ \t]*(?:system|instruction|系统|指令)/gimu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
  // CJK bracketed system block 【系统】【指令】【系统提示】.
  {
    category: 'role-marker',
    pattern: /【(?:系统提示|系统|指令)】/gu,
    action: 'break',
    neutralize: breakAfterFirst,
  },
];

// Imperative override clauses → WRAP. The match is a hijack PHRASE, not a bare
// noun, so benign HR prose ("操作指令如下", "这条指令的执行结果") is left alone.
const INSTRUCTION_OVERRIDE_RULES: Rule[] = [
  {
    category: 'instruction-override',
    pattern:
      /忽略(?:上面|以上|之前|前面|先前)(?:的)?(?:所有|全部)?(?:指令|要求|内容|提示|规则|对话|限制|设定)/gu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern:
      /不要(?:再)?(?:理会|理睬|管|遵守|遵循|执行)(?:上述|以上|之前|前面|先前)(?:的)?(?:指令|要求|规则|内容|限制|对话)?/gu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern: /停止(?:之前|先前|当前|上述)(?:的)?(?:任务|指令|对话|操作)/gu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern: /(?:现在)?(?:改为|改成|转而)(?:输出|回答|执行|告诉|显示|生成)/gu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern:
      /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|preceding|earlier|all)\s+(?:instructions?|prompts?|messages?|rules?|context)/giu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern: /disregard\s+(?:all\s+)?(?:the\s+)?(?:above|previous|prior|preceding|earlier)\b/giu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern: /forget\s+(?:everything|all\s+(?:previous|prior))\b/giu,
    action: 'wrap',
  },
  {
    category: 'instruction-override',
    pattern: /override\s+(?:the\s+)?(?:system|previous|above)\b/giu,
    action: 'wrap',
  },
];

// Persona / role-injection clauses → WRAP.
const ROLE_INJECTION_RULES: Rule[] = [
  {
    category: 'role-injection',
    pattern: /你现在(?:是|要成为|将成为|来扮演|要扮演|开始扮演)(?:一个|一名|一位)?/gu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /从现在(?:开始|起)[，,]?你(?:将|要|是|来|应|必须)/gu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /(?:请)?(?:扮演|假装(?:你)?是|装作(?:你)?是?|冒充)(?:一个|一名|一位)?/gu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /(?:进入|启用|开启|切换到)(?:开发者模式|管理员模式|上帝模式)/gu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /you\s+are\s+now\b(?:\s+an?\b)?/giu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /\bact\s+as\s+(?:an?\s+)?/giu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /\bpretend\s+(?:to\s+be|you\s+are)\b/giu,
    action: 'wrap',
  },
  {
    category: 'role-injection',
    pattern: /\b(?:developer\s+mode|DAN\s+mode|DAN)\b/giu,
    action: 'wrap',
  },
];

const RULES: readonly Rule[] = [
  ...ROLE_MARKER_RULES,
  ...INSTRUCTION_OVERRIDE_RULES,
  ...ROLE_INJECTION_RULES,
];

/**
 * Recognizes a wrap block THIS function produced: open/close tokens match (the
 * `\2` backreference) AND the enclosed text hashes to that token. The hash gate
 * is what tells "mine, already cleaned — freeze it" apart from a forged block
 * with an arbitrary token (which falls through to be broken + re-detected).
 */
const FROZEN_BLOCK_RE =
  /⟦untrusted:(?:instruction-override|role-injection):([0-9a-z]+)⟧([\s\S]*?)⟦\/untrusted:\1⟧/gu;

/** Code-point offset of a UTF-16 position (regex `.index`) into `content`. */
function codePointIndex(content: string, utf16Pos: number): number {
  return [...content.slice(0, utf16Pos)].length;
}

/** Wrap a flagged span in a deterministic, content-hashed untrusted annotation. */
function wrapSpan(category: InjectionCategory, span: string): string {
  const token = fenceToken(span);
  return `⟦untrusted:${category}:${token}⟧${span}⟦/untrusted:${token}⟧`;
}

interface RawMatch {
  start: number; // UTF-16, absolute in original content
  end: number; // UTF-16, absolute
  category: InjectionCategory;
  action: RuleAction;
  span: string;
  neutralize: ((span: string) => string) | undefined;
}

/** UTF-16 ranges (`[start, end)`) of the wrap blocks this function emitted. */
function findFrozenRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of content.matchAll(FROZEN_BLOCK_RE)) {
    const token = m[1] ?? '';
    const interior = m[2] ?? '';
    if (m.index !== undefined && fenceToken(interior) === token) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

/**
 * Detect + neutralize one OPEN segment (a gap between frozen blocks). Matches
 * are collected across all rules, overlaps resolved (earliest start wins, then
 * longest), and the segment rebuilt. Detections carry ORIGINAL-content
 * code-point offsets (`baseUtf16` is the segment's start in the original).
 */
function neutralizeOpen(
  segment: string,
  baseUtf16: number,
  content: string,
  maxExcerptChars: number,
): { rebuilt: string; detections: InjectionDetection[] } {
  const raw: RawMatch[] = [];
  for (const rule of RULES) {
    for (const m of segment.matchAll(rule.pattern)) {
      if (m.index === undefined) continue;
      const span = m[0];
      if (span === '') continue;
      raw.push({
        start: baseUtf16 + m.index,
        end: baseUtf16 + m.index + span.length,
        category: rule.category,
        action: rule.action,
        span,
        neutralize: rule.neutralize,
      });
    }
  }
  // Source order; on a tie at the same start, the longer match wins so a
  // specific clause isn't pre-empted by a shorter overlapping one.
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const picked: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start < lastEnd) continue; // overlaps an already-picked match
    picked.push(m);
    lastEnd = m.end;
  }

  let rebuilt = '';
  let cursor = baseUtf16; // UTF-16 position in `content`
  const detections: InjectionDetection[] = [];
  for (const m of picked) {
    rebuilt += content.slice(cursor, m.start);
    rebuilt += m.action === 'wrap' ? wrapSpan(m.category, m.span) : (m.neutralize ?? ((s) => s))(m.span);
    cursor = m.end;
    const cps = [...m.span];
    detections.push({
      category: m.category,
      excerpt: cps.length > maxExcerptChars ? cps.slice(0, maxExcerptChars).join('') : m.span,
      index: codePointIndex(content, m.start),
    });
  }
  rebuilt += content.slice(cursor, baseUtf16 + segment.length);
  return { rebuilt, detections };
}

/**
 * Detect and neutralize injection patterns in retrieved `content` before it
 * re-enters a model context. Pure, deterministic, stateless; resolves to a
 * {@link SanitizeResult}. Idempotent — see the module header.
 *
 * The returned `sanitized` keeps every original character (defang, never
 * delete); structural tokens are broken, imperative / persona clauses wrapped
 * in `⟦untrusted:<category>:<token>⟧…⟦/untrusted:<token>⟧`. A consumer that
 * embeds the result should tell the model these markers fence flagged,
 * not-to-be-executed data (the same posture as the `wrapUntrustedBlock`
 * preface).
 */
export function sanitizeRetrievedContent(
  content: string,
  options?: SanitizeOptions,
): SanitizeResult {
  const requested = options?.maxExcerptChars;
  const maxExcerptChars =
    typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : DEFAULT_MAX_EXCERPT_CHARS;

  const frozen = findFrozenRanges(content);
  let out = '';
  const detections: InjectionDetection[] = [];
  let pos = 0;
  // Append a zero-width terminal frozen range so the trailing open gap is
  // processed by the same loop body.
  for (const [fs, fe] of [...frozen, [content.length, content.length] as [number, number]]) {
    if (pos < fs) {
      const segment = content.slice(pos, fs);
      const { rebuilt, detections: dets } = neutralizeOpen(segment, pos, content, maxExcerptChars);
      out += rebuilt;
      detections.push(...dets);
    }
    if (fs < fe) out += content.slice(fs, fe); // frozen block, verbatim
    pos = fe;
  }

  return { sanitized: out, flagged: detections.length > 0, detections };
}
