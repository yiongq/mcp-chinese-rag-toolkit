[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / generateChunkContext

# Function: generateChunkContext()

> **generateChunkContext**(`chunk`, `opts`, `llm`): `Promise`\<`string`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts:71](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/contextual-retrieval.ts#L71)

Generate a contextual prefix for a single chunk using prompt caching.

CRITICAL — the caller MUST invoke this with the SAME `cacheKey` for
all chunks of the same source document; otherwise the provider's
prompt cache treats every request as a miss and token cost stays at
100% instead of dropping to ≤ 50%.

Recommended `cacheKey` is the document's sha256 (or any stable
per-source identifier). For deterministic chunk-context generation
across CI runs prefer `path.basename(source) + ':' + contentSha256`.

Provider injection rationale: the toolkit does not depend on any
specific LLM SDK (architecture §AI Agent 强制规则 #4) — the caller
(e.g. a downstream consumer package build-index script) instantiates Anthropic /
OpenAI / 豆包 clients with their own API key and adapts the response
to [LlmProvider](../interfaces/LlmProvider.md). Provider-side `cache_control` orchestration
lives in the adapter; this helper only stitches the prompt skeleton.

The result is `.trim()`'d defensively — providers occasionally
return trailing whitespace / newlines even with explicit
instructions; cleanup keeps the stored chunk pure prefix.

## Parameters

### chunk

[`Chunk`](../interfaces/Chunk.md)

### opts

[`ContextualRetrievalOptions`](../interfaces/ContextualRetrievalOptions.md)

### llm

[`LlmProvider`](../interfaces/LlmProvider.md)

## Returns

`Promise`\<`string`\>
