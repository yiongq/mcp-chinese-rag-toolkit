[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / FusedRow

# Interface: FusedRow\<T\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:281](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L281)

Output row from `rrfFuse`. `ranks[i]` / `payloads[i]` mirror the order of
the input `sources` array; entries are `null` when the corresponding
source did not return this id — BDD#2 single-source survival relies on
this contract.

## Type Parameters

### T

`T`

## Properties

### id

> **id**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:282](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L282)

***

### payloads

> **payloads**: (`T` \| `null`)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:288](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L288)

Per-source payload lookup. `null` for sources that did not hit `id`.

***

### ranks

> **ranks**: (`number` \| `null`)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:286](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L286)

Per-source rank lookup. `null` for sources that did not hit `id`.

***

### score

> **score**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:284](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/types.ts#L284)

Accumulated RRF score `Σ 1/(k + rank_i)` over every source that contained `id`.
