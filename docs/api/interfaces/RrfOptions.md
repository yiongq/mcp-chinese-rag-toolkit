[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RrfOptions

# Interface: RrfOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:292](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L292)

Options for `rrfFuse`.

## Properties

### k?

> `optional` **k?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:294](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L294)

RRF constant — defaults to 60 (Cormack 2009 / Elasticsearch / Weaviate convention). Range [1, 1000].

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:296](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L296)

Final fused top-K cap.

#### Default

```ts
Infinity (return everything fused)
```
