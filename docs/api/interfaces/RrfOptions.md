[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RrfOptions

# Interface: RrfOptions

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:300](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L300)

Options for `rrfFuse`.

## Properties

### k?

> `optional` **k?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:302](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L302)

RRF constant — defaults to 60 (Cormack 2009 / Elasticsearch / Weaviate convention). Range [1, 1000].

***

### topK?

> `optional` **topK?**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:304](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L304)

Final fused top-K cap.

#### Default

```ts
Infinity (return everything fused)
```
