[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / openCaptionCache

# Function: openCaptionCache()

> **openCaptionCache**(`opts`): [`CaptionCache`](../interfaces/CaptionCache.md)

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts:112](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/plugins/caption-cache.ts#L112)

Open (or create) the caption cache. Schema is created on demand:

  CREATE TABLE IF NOT EXISTS image_caption_cache (
    image_sha256  TEXT NOT NULL,
    prompt_sha256 TEXT NOT NULL,
    provider_id   TEXT NOT NULL,
    model_id      TEXT NOT NULL,
    caption_text  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (image_sha256, prompt_sha256, provider_id, model_id)
  )

## Parameters

### opts

[`CaptionCacheOptions`](../interfaces/CaptionCacheOptions.md)

## Returns

[`CaptionCache`](../interfaces/CaptionCache.md)
