[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ResourceDefinitionInput

# Interface: ResourceDefinitionInput

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:19](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L19)

## Properties

### list

> **list**: () => `Promise`\<\{ `resources`: [`ResourceListEntry`](ResourceListEntry.md)[]; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:24](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L24)

List all readable resource instances.

#### Returns

`Promise`\<\{ `resources`: [`ResourceListEntry`](ResourceListEntry.md)[]; \}\>

***

### mimeType?

> `optional` **mimeType?**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:22](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L22)

***

### read

> **read**: (`uri`, `vars`) => `Promise`\<[`ResourceReadResult`](ResourceReadResult.md)\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:29](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L29)

Read a single resource. `vars` originates from RFC 6570 expansion of
`{scheme}://{kind}/{id}`.

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

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:21](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L21)

***

### uriScheme

> **uriScheme**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts:20](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/packages/mcp-chinese-rag-toolkit/src/server/resource-provider.ts#L20)
