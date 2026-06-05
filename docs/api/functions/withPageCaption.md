[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / withPageCaption

# Function: withPageCaption()

> **withPageCaption**(`opts`): [`IndexingPlugin`](../interfaces/IndexingPlugin.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/with-page-caption.ts:154](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/with-page-caption.ts#L154)

Create an  indexing plugin that captions WHOLE PDF pages by rendering
each selected page to a PNG (`unpdf.renderPageAsImage`) and captioning it
with a caller-injected vision LLM. The synthetic Chinese caption chunks
flow into the same `docs / docs_fts / docs_vec` storage as text chunks, so
the runtime retrieval path is unaffected.

Contrast with import('./with-vision-caption.js').withVisionCaption,
which captions each EMBEDDED image. For slide-style / scanned / vector
PDFs, per-image extraction emits one noisy caption per logo / decoration
(and `extractImages` can even throw `DataCloneError` on some PDFs), whereas
whole-page rendering captures the page's real meaning — org charts, system
screenshots, vector flowcharts — in exactly one caption per page.

Lifecycle:
  1. factory: validate options.
  2. enrichPdf: ensure `@napi-rs/canvas` present (fail-fast at index start,
     NOT at first page) → filter pages by `selectPage` →
     `renderPageAsImage` (concurrency-limited) → caption (retry on
     transient errors, timeout per call, shared caption cache) → synthetic
     `Chunk[]`. Cache handle disposed via try/finally regardless of path.

## Parameters

### opts

[`PageCaptionOptions`](../interfaces/PageCaptionOptions.md)

## Returns

[`IndexingPlugin`](../interfaces/IndexingPlugin.md)
