[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ResourceDefinition

# Interface: ResourceDefinition

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:32](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L32)

## Properties

### list

> **list**: () => `Promise`\<\{ `resources`: [`ResourceListEntry`](ResourceListEntry.md)[]; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:37](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L37)

#### Returns

`Promise`\<\{ `resources`: [`ResourceListEntry`](ResourceListEntry.md)[]; \}\>

***

### mimeType?

> `optional` **mimeType?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:36](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L36)

***

### read

> **read**: (`uri`, `vars`) => `Promise`\<[`ResourceReadResult`](ResourceReadResult.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:38](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L38)

#### Parameters

##### uri

`URL`

##### vars

###### id

`string`

###### kind

`string`

#### Returns

`Promise`\<[`ResourceReadResult`](ResourceReadResult.md)\>

***

### title?

> `optional` **title?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:35](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L35)

***

### uriScheme

> **uriScheme**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:33](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L33)

***

### uriTemplate

> **uriTemplate**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:34](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L34)
