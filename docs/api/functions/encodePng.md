[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / encodePng

# Function: encodePng()

> **encodePng**(`pixels`, `width`, `height`, `channels`, `maxLongestEdge?`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/png-encoder.ts:80](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/png-encoder.ts#L80)

Encode a raw RGBA / RGB / Grayscale pixel buffer (as returned by
`unpdf.extractImages`) to PNG bytes, optionally downsampling so
`max(width, height) <= maxLongestEdge` while preserving aspect ratio.

Determinism: identical `(pixels, width, height, channels, maxLongestEdge)`
input always produces byte-identical PNG output, which is what makes the
caption cache key (`sha256(pngBytes)`) stable across re-indexes.

## Parameters

### pixels

`Uint8ClampedArray`

Raw pixel buffer from `unpdf.extractImages`.

### width

`number`

Original width in pixels.

### height

`number`

Original height in pixels.

### channels

`1` \| `3` \| `4`

1 (grayscale) | 3 (RGB) | 4 (RGBA).

### maxLongestEdge?

`number` = `1568`

Resize ceiling (px).

## Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

PNG bytes ready to send to a vision LLM provider.

## Default

```ts
1568
```
