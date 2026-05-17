import type { Chunk, ContextualRetrievalOptions, LlmProvider } from './types.js';

/**
 * Default prefix length range — picks ~50-100 chars to add a semantic
 * anchor without bloating chunk size. Source: Anthropic 2024-09 blog
 * "Introducing Contextual Retrieval" §"Implementing Contextual
 * Retrieval", recommended bound.
 */
export const DEFAULT_PREFIX_LENGTH = { min: 50, max: 100 } as const;

/**
 * Render the toolkit's canonical prompt template for chunk-context
 * generation. Exposed for test introspection + so multiple toolkit
 * consumers (mcp-hr / mcp-modeling) emit comparable Hit Rate metrics
 * by sharing the same wording.
 *
 * The rendered output is NOT submitted directly — providers (Anthropic
 * / OpenAI / 豆包) accept the `(system, user)` pair via their own SDK
 * message shape (see Story 2.6 AC5 §Anthropic adapter example) and
 * apply `cache_control: { type: 'ephemeral' }` to the system block.
 *
 * NOTE: This helper is completely independent from the L0 LRU cache
 * (`src/middleware/with-lru-cache.ts`). The two modules share the word
 * "cache" but run on disjoint code paths (indexing-time prompt cache
 * vs query-time tool-result cache).
 */
export function renderChunkContextPrompt(args: {
  fullDocument: string;
  chunkContent: string;
  prefixLength: { min: number; max: number };
}): { system: string; user: string } {
  const { fullDocument, chunkContent, prefixLength } = args;
  const system =
    '你是文档检索辅助助手。给定一份完整文档和文档中的一个片段，' +
    `生成一段 ${prefixLength.min}-${prefixLength.max} 字的中文上下文 prefix，` +
    '用于改进该片段在 BM25 + 向量混合检索系统中的召回准确率。\n' +
    'Prefix 必须：(1) 指出片段所在的章节、主题或上下文位置；' +
    '(2) 不重复片段本身的具体内容；(3) 不使用引号、括号或 Markdown 标记；' +
    '(4) 简洁、信息密度高，便于 BM25 关键词命中 + 语义向量距离收敛。\n\n' +
    '完整文档如下：\n' +
    fullDocument;
  const user =
    '请为下面这个片段生成上下文 prefix（直接输出 prefix 文本，不要任何解释或前缀）：\n\n' +
    chunkContent;
  return { system, user };
}

/**
 * Generate a contextual prefix for a single chunk using prompt caching.
 *
 * CRITICAL — the caller MUST invoke this with the SAME `cacheKey` for
 * all chunks of the same source document; otherwise the provider's
 * prompt cache treats every request as a miss and token cost stays at
 * 100% instead of dropping to ≤ 50% (FR15 contract).
 *
 * Recommended `cacheKey` is the document's sha256 (or any stable
 * per-source identifier). For deterministic chunk-context generation
 * across CI runs prefer `path.basename(source) + ':' + contentSha256`.
 *
 * Provider injection rationale: the toolkit does not depend on any
 * specific LLM SDK (architecture §AI Agent 强制规则 #4) — the caller
 * (e.g. mcp-hr Story 4.1 build-index script) instantiates Anthropic /
 * OpenAI / 豆包 clients with their own API key and adapts the response
 * to {@link LlmProvider}. Provider-side `cache_control` orchestration
 * lives in the adapter; this helper only stitches the prompt skeleton.
 *
 * The result is `.trim()`'d defensively — providers occasionally
 * return trailing whitespace / newlines even with explicit
 * instructions; cleanup keeps the stored chunk pure prefix.
 */
export async function generateChunkContext(
  chunk: Chunk,
  opts: ContextualRetrievalOptions,
  llm: LlmProvider,
): Promise<string> {
  const prefixLength = opts.prefixLength ?? DEFAULT_PREFIX_LENGTH;
  const cacheKey = opts.cacheKey ?? 'default';
  if (typeof opts.fullDocument !== 'string' || opts.fullDocument.length === 0) {
    throw new Error('generateChunkContext: opts.fullDocument must be a non-empty string');
  }
  if (typeof chunk.content !== 'string' || chunk.content.length === 0) {
    throw new Error('generateChunkContext: chunk.content must be a non-empty string');
  }
  if (
    !Number.isInteger(prefixLength.min) ||
    !Number.isInteger(prefixLength.max) ||
    prefixLength.min < 10 ||
    prefixLength.max > 500 ||
    prefixLength.min > prefixLength.max
  ) {
    throw new Error('generateChunkContext: prefixLength.min/max must satisfy 10 ≤ min ≤ max ≤ 500');
  }
  const prefix = await llm.generateChunkPrefix({
    fullDocument: opts.fullDocument,
    chunkContent: chunk.content,
    cacheKey,
    prefixLength,
  });
  // Defensive: a faulty provider adapter (returning null / undefined / an
  // image-block / a number) would otherwise crash `.trim()` with an
  // opaque TypeError; surface an actionable message that names the
  // failing surface so build-index scripts can isolate the bad chunk.
  if (typeof prefix !== 'string') {
    throw new TypeError(
      `generateChunkContext: LlmProvider.generateChunkPrefix must return a string, got ${typeof prefix}`,
    );
  }
  return prefix.trim();
}

/**
 * Splice the generated prefix into a chunk by prepending + double-
 * newline. Indexing-path callers should set
 * `db.docs.content = stitchPrefixedChunk(chunk, prefix)` BEFORE
 * running BM25 tokenization / embedding.
 *
 * Pure function — test / inspection tooling can replay the stitching
 * without re-querying the LLM. Preserves the input chunk's
 * `source / page / section` metadata unchanged.
 */
export function stitchPrefixedChunk(chunk: Chunk, prefix: string): Chunk {
  if (prefix.length === 0) return chunk;
  return { ...chunk, content: `${prefix}\n\n${chunk.content}` };
}
