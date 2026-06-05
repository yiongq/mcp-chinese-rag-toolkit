[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / RankedRow

# Interface: RankedRow\<T\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:274](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L274)

Rank-bearing input row consumed by `rrfFuse`. Generic so callers can fuse
`FtsHit[]` (using `bm25Rank`) and `VecHit[]` (using `arrayIndex + 1`)
without coercing them into a shared intermediate object shape.

## Type Parameters

### T

`T`

## Properties

### id

> **id**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:276](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L276)

Stable identifier — typically `docId` from [FtsHit](FtsHit.md) / [VecHit](VecHit.md).

***

### payload

> **payload**: `T`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:278](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L278)

Caller-supplied payload (passed through unchanged into the fused result).

***

### rank

> **rank**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:280](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L280)

1-indexed rank within this list (so `1/(k + 1)` for the top element).
