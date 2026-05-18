[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / withVisionCaption

# Function: withVisionCaption()

> **withVisionCaption**(`opts`): [`IndexingPlugin`](../interfaces/IndexingPlugin.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/with-vision-caption.ts:156](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/with-vision-caption.ts#L156)

Create an FR20 indexing plugin that captions PDF images using a
caller-injected vision LLM provider. Synthetic Chinese caption chunks
flow into the same `docs / docs_fts / docs_vec` storage as text chunks
(architecture §RAG Indexing Strategy L292-299).

Lifecycle:
  1. factory: validate options + ensure `@napi-rs/canvas` present
     (fail-fast at index start, NOT at first image).
  2. enrichPdf: iterate pages → `unpdf.extractImages` → PNG-encode →
     cache lookup → `provider.caption` (concurrency-limited, retry on
     transient errors, timeout per call) → cache write → synthetic
     `Chunk[]`. Cache handle disposed via try/finally regardless of
     success path (Story 2.5 教训 1).

## Parameters

### opts

[`VisionCaptionOptions`](../interfaces/VisionCaptionOptions.md)

## Returns

[`IndexingPlugin`](../interfaces/IndexingPlugin.md)
