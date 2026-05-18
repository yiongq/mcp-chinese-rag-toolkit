[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / LlmProvider

# Interface: LlmProvider

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:607](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L607)

Provider abstraction injected into `generateChunkContext`. Mirrors
 Anthropic / OpenAI / 豆包 chat completion shape so callers can plug in
 any provider that supports prompt caching (Anthropic Phase 1 target;
 others Phase 2 via provider adapter). The toolkit deliberately does
 NOT depend on `@anthropic-ai/sdk` — caller-side wiring keeps bundle
 size minimal and avoids locking consumers into a single vendor.

## Methods

### generateChunkPrefix()

> **generateChunkPrefix**(`args`): `Promise`\<`string`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:613](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L613)

Generate prefix text given a (system, user) message pair where the
 system block carries `cache_control: { type: 'ephemeral' }` for the
 full document. `cacheKey` is the stable identity used by callers to
 group requests under the same cache_control entry (typically the
 source document's sha256).

#### Parameters

##### args

###### cacheKey

`string`

###### chunkContent

`string`

###### fullDocument

`string`

###### prefixLength

\{ `max`: `number`; `min`: `number`; \}

###### prefixLength.max

`number`

###### prefixLength.min

`number`

#### Returns

`Promise`\<`string`\>
