[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / FusedRow

# Interface: FusedRow\<T\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:289](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L289)

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

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:290](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L290)

***

### payloads

> **payloads**: (`T` \| `null`)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:296](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L296)

Per-source payload lookup. `null` for sources that did not hit `id`.

***

### ranks

> **ranks**: (`number` \| `null`)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:294](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L294)

Per-source rank lookup. `null` for sources that did not hit `id`.

***

### score

> **score**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:292](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L292)

Accumulated RRF score `Σ 1/(k + rank_i)` over every source that contained `id`.
