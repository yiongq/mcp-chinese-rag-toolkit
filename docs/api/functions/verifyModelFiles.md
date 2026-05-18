[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / verifyModelFiles

# Function: verifyModelFiles()

> **verifyModelFiles**(`cacheDir`, `manifest`, `opts?`): `Promise`\<`void`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/model-loader.ts:117](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/rag/model-loader.ts#L117)

Verify that the cached files under `<cacheDir>/<manifest.modelId>/...`
match the pinned hashes byte-for-byte.

Sequential streaming hash (one file at a time) keeps memory peak bounded
— model.onnx alone is ~600 MB; parallel hashing would risk OOM on
resource-constrained CI runners.

## Parameters

### cacheDir

`string`

### manifest

[`ModelManifest`](../interfaces/ModelManifest.md)

### opts?

`VerifyOptions`

## Returns

`Promise`\<`void`\>
