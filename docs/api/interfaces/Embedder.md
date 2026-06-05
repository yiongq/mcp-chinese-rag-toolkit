[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / Embedder

# Interface: Embedder

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:250](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L250)

Result returned by [loadEmbedder](../functions/loadEmbedder.md).

`embed` / `embedBatch` produce L2-normalized vectors (`Σ x_i² ≈ 1`)
suitable for direct insertion into a sqlite-vec `docs_vec` table opened
with [openIndex](../functions/openIndex.md). `dim` MUST equal `meta.embedding_dim`; mismatches
are caught by `schema.ts` at index-open time.

## Properties

### dim

> `readonly` **dim**: `number`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:260](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L260)

Vector dimension. Sourced from `manifest.embeddingDim` at load time (1024 for bge-large-zh-v1.5).

***

### modelId

> `readonly` **modelId**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:262](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L262)

Echo of the manifest's `modelId` — written to `meta.embedding_model` by [writeEmbedderMeta](../functions/writeEmbedderMeta.md).

## Methods

### embed()

> **embed**(`text`): `Promise`\<`Float32Array`\<`ArrayBufferLike`\>\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:252](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L252)

Compute a single L2-normalized embedding. `result.length === dim`.

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`Float32Array`\<`ArrayBufferLike`\>\>

***

### embedBatch()

> **embedBatch**(`texts`, `opts?`): `Promise`\<`Float32Array`\<`ArrayBufferLike`\>[]\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/types.ts:258](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/types.ts#L258)

Batched variant; semantically equivalent to N sequential `embed` calls
but uses a single tokenization + ONNX forward when `batchSize > 1`.
`batchSize` is clamped to `[1, 256]`; values outside the range throw.

#### Parameters

##### texts

`string`[]

##### opts?

###### batchSize?

`number`

#### Returns

`Promise`\<`Float32Array`\<`ArrayBufferLike`\>[]\>
