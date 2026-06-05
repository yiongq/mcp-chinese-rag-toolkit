[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / McpToolDefinition

# Interface: McpToolDefinition

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:15](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L15)

## Properties

### description

> **description**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:17](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L17)

***

### handler

> **handler**: (`args`) => \{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:19](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L19)

#### Parameters

##### args

`unknown`

#### Returns

\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (... \| ...)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \} \| `Promise`\<\{\[`key`: `string`\]: `unknown`; `_meta?`: \{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}; `content`: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: ...[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: ...\]: ...; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]; `isError?`: `boolean`; `structuredContent?`: \{\[`key`: `string`\]: `unknown`; \}; \}\>

***

### inputSchema

> **inputSchema**: `ZodTypeAny`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:18](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L18)

***

### name

> **name**: `string`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/create-mcp-server.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/create-mcp-server.ts#L16)
