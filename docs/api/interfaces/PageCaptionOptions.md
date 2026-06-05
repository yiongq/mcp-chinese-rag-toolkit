[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / PageCaptionOptions

# Interface: PageCaptionOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:154](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L154)

Options for `withPageCaption`. Like [VisionCaptionOptions](VisionCaptionOptions.md) but the
unit of work is a WHOLE rendered page (via `unpdf.renderPageAsImage`),
not each embedded image (`unpdf.extractImages`). Use this for slide-style /
scanned / vector-flowchart PDFs where the meaningful content is the page as
a whole and per-image extraction would emit one noisy caption per logo /
decoration. Shares the same [VisionProvider](VisionProvider.md), caption cache, default
prompt, retry + backoff, timeout safety net and concurrency cap as
`withVisionCaption`.

## Properties

### cacheDir?

> `optional` **cacheDir?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:164](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L164)

Caption SQLite cache directory. Shared with `withVisionCaption` — the
rendered-page PNG bytes are the cache key, so the two plugins never
collide.

#### Default

`<userCacheDir>/mcp-chinese-rag-toolkit/caption-cache`.

***

### markSyntheticChunk?

> `optional` **markSyntheticChunk?**: `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:192](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L192)

When true, generated chunk `.section` is `'[图片描述]'`; when false,
`.section` is `undefined` (caption blends transparently into the text
stream).

#### Default

```ts
true
```

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:158](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L158)

Concurrency cap across `provider.caption()` calls.

#### Default

```ts
3
```

***

### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:175](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L175)

Per-page retry count on transient errors (timeout / 5xx / 429).
Exponential backoff `500ms / 1500ms / ...`

#### Default

```ts
2
```

***

### minTextLength?

> `optional` **minTextLength?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:214](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L214)

Threshold for the DEFAULT page-selection predicate: a page is captioned
when `page.text.trim().length < minTextLength`. Ignored when `selectPage`
is supplied. The boilerplate copyright line repeated on every page (~65
chars) means anything under ~90 carries no real text.

#### Default

```ts
90
```

***

### onFailure?

> `optional` **onFailure?**: `"skip-page"` \| `"fail-index"`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:186](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L186)

Per-page failure mode after retries exhausted.
 - `'skip-page'` (default): warn + skip the page; index continues.
 - `'fail-index'`: throw [VisionCaptionFailedError](../classes/VisionCaptionFailedError.md); caller decides
   recovery.

Never silently swallows errors regardless of mode.

#### Default

```ts
'skip-page'
```

***

### promptTemplate?

> `optional` **promptTemplate?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:170](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L170)

Override the default prompt template. The plugin hashes the FINAL
rendered prompt for the cache key, so changing this string invalidates
cached captions.

#### Default

see `DEFAULT_VISION_PROMPT`.

***

### provider

> **provider**: [`VisionProvider`](VisionProvider.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:156](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L156)

Caller-injected vision LLM. REQUIRED — toolkit ships zero vendor SDKs.

***

### scale?

> `optional` **scale?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:199](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L199)

Render scale forwarded to `unpdf.renderPageAsImage`. 1.0 reproduces the
page at its native PDF point size; bump (e.g. 2.0) for sharper OCR on
dense slides at the cost of larger PNGs / more provider tokens.

#### Default

```ts
1.0
```

***

### selectPage?

> `optional` **selectPage?**: (`page`) => `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:207](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L207)

Predicate selecting which pages to render + caption. Receives each
[PdfPage](PdfPage.md) and returns `true` to caption it. Overrides
`minTextLength` when provided.

#### Parameters

##### page

[`PdfPage`](PdfPage.md)

#### Returns

`boolean`

#### Default

selects pages whose trimmed text
length is `< minTextLength` (i.e. image-only / title-only pages whose
meaning lives in the rendered page, not the extracted text).

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/types.ts:177](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/types.ts#L177)

Per-page timeout in milliseconds passed to provider.

#### Default

```ts
30000
```
