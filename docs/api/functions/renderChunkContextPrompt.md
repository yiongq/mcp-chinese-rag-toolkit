[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / renderChunkContextPrompt

# Function: renderChunkContextPrompt()

> **renderChunkContextPrompt**(`args`): `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/contextual-retrieval.ts:27](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/contextual-retrieval.ts#L27)

Render the toolkit's canonical prompt template for chunk-context
generation. Exposed for test introspection + so multiple toolkit
consumers (a downstream consumer package / a downstream consumer package) emit comparable Hit Rate metrics
by sharing the same wording.

The rendered output is NOT submitted directly — providers (Anthropic
/ OpenAI / 豆包) accept the `(system, user)` pair via their own SDK
message shape (see AC5 §Anthropic adapter example) and
apply `cache_control: { type: 'ephemeral' }` to the system block.

NOTE: This helper is completely independent from the L0 LRU cache
(`src/middleware/with-lru-cache.ts`). The two modules share the word
"cache" but run on disjoint code paths (indexing-time prompt cache
vs query-time tool-result cache).

## Parameters

### args

#### chunkContent

`string`

#### fullDocument

`string`

#### prefixLength

\{ `max`: `number`; `min`: `number`; \}

#### prefixLength.max

`number`

#### prefixLength.min

`number`

## Returns

`object`

### system

> **system**: `string`

### user

> **user**: `string`
