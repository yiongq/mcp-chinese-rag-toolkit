[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / VisionProvider

# Interface: VisionProvider

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:62](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L62)

Caller-injected vision LLM provider. Toolkit deliberately does NOT bind
to `@anthropic-ai/sdk` / `openai` / 豆包 SDK / qwen SDK —
`templates/anthropic-vision-provider.ts` is a reference adapter the
caller copies + fills in their own API key.

Mirrors Story 2.6 import('../types.js').LlmProvider (contextual
retrieval) + Story 2.7 `EvalSearchFn` (eval framework) provider-injection
patterns. Toolkit `dependencies` stays free of vendor SDKs (NFR36 npm
package size guard + Story 2.6 教训 9).

## Properties

### modelId

> `readonly` **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:73](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L73)

Model identity (e.g. `'doubao-vision-pro-32k'`, `'claude-haiku-4-5'`).
Written into cache key — model bumps invalidate cache.

***

### providerId

> `readonly` **providerId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:68](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L68)

Provider identity (kebab-case, e.g. `'doubao-vision'`, `'anthropic'`,
`'qwen-vl'`, `'openai'`). Written into the caption cache key so
provider switches invalidate cached captions.

## Methods

### caption()

> **caption**(`args`): `Promise`\<`string`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:84](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts#L84)

Caption a single PNG-encoded image. MUST return a non-empty string
(200-300 chars Chinese is the target; toolkit does not enforce length
since providers occasionally return shorter output on simple images).

MUST honor `timeoutMs` via internal `AbortController` / provider SDK
timeout. Throw an `Error` with `name === 'AbortError'` on timeout so
the retry policy in import('./with-vision-caption.js').withVisionCaption
can classify it correctly.

#### Parameters

##### args

###### imagePng

`Uint8Array`

###### prompt

`string`

###### timeoutMs

`number`

#### Returns

`Promise`\<`string`\>
