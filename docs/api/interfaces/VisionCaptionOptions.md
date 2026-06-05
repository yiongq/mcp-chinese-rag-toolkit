[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / VisionCaptionOptions

# Interface: VisionCaptionOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:92](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L92)

Options for `withVisionCaption`. All fields except `provider` are
optional; defaults align with ADR-0008 §Provider 选型矩阵
`concurrency=3` scenario.

## Properties

### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:103](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L103)

Caption SQLite cache directory.

#### Default

`<userCacheDir>/mcp-chinese-rag-toolkit/caption-cache` (resolved via
the same env-paths logic uses for model cache, but under a
disjoint subpath so model cache and caption cache never collide).

***

### markSyntheticChunk?

> `optional` **markSyntheticChunk?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:133](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L133)

When true, generated chunk `.section` is `'[图片描述 #<idx>]'`; when
false, `.section` is `undefined` (caption blends transparently into
the text stream).

#### Default

```ts
true
```

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:96](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L96)

Concurrency cap across `provider.caption()` calls.

#### Default

```ts
3
```

***

### maxLongestEdge?

> `optional` **maxLongestEdge?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:141](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L141)

Resize ceiling — images with `max(width, height) > maxLongestEdge` are
downsampled keeping aspect ratio. 1568 is the common-denominator safe
upper bound across 4 providers (Anthropic max 1568, OpenAI max 2048,
豆包 max 2048, 千问 max 1792 — pick the lowest for cross-provider
portability).

#### Default

```ts
1568
```

***

### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:115](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L115)

Per-image retry count on transient errors (timeout / 5xx / 429).
Exponential backoff `500ms / 1500ms / ...`

#### Default

```ts
2
```

***

### onFailure?

> `optional` **onFailure?**: `"fail-index"` \| `"skip-image"`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:127](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L127)

Per-image failure mode after retries exhausted.
 - `'skip-image'` (default): warn + skip the image; index continues.
 - `'fail-index'`: throw [VisionCaptionFailedError](../classes/VisionCaptionFailedError.md); caller decides
   recovery.

Never silently swallows errors regardless of mode (教训 2
fail-fast + actionable error).

#### Default

```ts
'skip-image'
```

***

### promptTemplate?

> `optional` **promptTemplate?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:110](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L110)

Override the default prompt template. The plugin hashes the FINAL
rendered prompt for the cache key, so changing this string invalidates
cached captions (intentional — different prompts produce different
captions).

#### Default

see `DEFAULT_VISION_PROMPT`.

***

### provider

> **provider**: [`VisionProvider`](VisionProvider.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:94](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L94)

Caller-injected vision LLM. REQUIRED — toolkit ships zero vendor SDKs.

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:117](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L117)

Per-image timeout in milliseconds passed to provider.

#### Default

```ts
30000
```
