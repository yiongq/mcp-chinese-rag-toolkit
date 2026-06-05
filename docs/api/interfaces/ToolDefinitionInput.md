[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ToolDefinitionInput

# Interface: ToolDefinitionInput\<I\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:15](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L15)

## Type Parameters

### I

`I` *extends* `z.ZodObject`\<`z.ZodRawShape`\>

## Properties

### description

> **description**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:17](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L17)

***

### examples?

> `optional` **examples?**: [`ToolExample`](ToolExample.md)[]

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:19](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L19)

***

### handler

> **handler**: (`args`) => \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:21](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L21)

#### Parameters

##### args

`TypeOf`\<`I`\>

#### Returns

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

***

### inputSchema

> **inputSchema**: `I`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:20](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L20)

***

### name

> **name**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L16)

***

### whenToUse

> **whenToUse**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/tool-builder.ts:18](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/tool-builder.ts#L18)
