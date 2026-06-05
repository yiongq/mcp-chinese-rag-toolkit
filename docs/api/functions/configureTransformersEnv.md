[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / configureTransformersEnv

# Function: configureTransformersEnv()

> **configureTransformersEnv**(`opts`): `void`

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/model-loader.ts:89](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/model-loader.ts#L89)

Apply `@huggingface/transformers` global `env` settings the toolkit cares
about, without overwriting unrelated fields users may have set in their
own bootstrap code. `env` is a module-level singleton — last write wins —
so we centralise toolkit-owned writes in this one call site.

## Parameters

### opts

#### allowRemoteModels

`boolean`

#### cacheDir

`string`

## Returns

`void`
