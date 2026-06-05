[**@yiong/mcp-chinese-rag-toolkit**](../../../../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../../../../README.md) / [errors](../README.md) / create

# Function: create()

> **create**(`code`, `message`, `opts?`): `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/errors.ts:49](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/errors.ts#L49)

## Parameters

### code

`string`

### message

`string`

### opts?

[`CreateErrorOptions`](../interfaces/CreateErrorOptions.md) = `{}`

## Returns

`object`

### \_meta?

> `optional` **\_meta?**: `object`

#### Index Signature

\[`key`: `string`\]: `unknown`

#### \_meta.io.modelcontextprotocol/related-task?

> `optional` **io.modelcontextprotocol/related-task?**: `object`

If specified, this request is related to the provided task.

#### \_meta.io.modelcontextprotocol/related-task.taskId

> **taskId**: `string`

#### \_meta.progressToken?

> `optional` **progressToken?**: `string` \| `number`

If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.

### content

> **content**: (\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]

### isError?

> `optional` **isError?**: `boolean`

### structuredContent?

> `optional` **structuredContent?**: `object`

#### Index Signature

\[`key`: `string`\]: `unknown`
