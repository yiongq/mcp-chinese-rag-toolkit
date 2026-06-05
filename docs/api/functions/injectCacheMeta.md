[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / injectCacheMeta

# Function: injectCacheMeta()

> **injectCacheMeta**(`result`, `status`): `object`

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:127](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/middleware/with-lru-cache.ts#L127)

Inject `structuredContent._meta.cache = status` without mutating the
input result. The `_meta` namespace (underscore prefix) avoids
collision with business fields; other `_meta.*` entries (e.g.
`_meta.indexVersion`) are owned by their respective writers.

Always called on BOTH read and write paths, so the
`structuredContent._meta.cache` field is guaranteed present and
accurate on every response that passes through [withLruCache](withLruCache.md) —
eval / OTel can rely on a binary contract instead of a truthy-or-
missing check.

## Parameters

### result

#### _meta?

\{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: \{ `taskId`: `string`; \}; `progressToken?`: `string` \| `number`; \}

#### _meta.io.modelcontextprotocol/related-task?

\{ `taskId`: `string`; \}

If specified, this request is related to the provided task.

#### _meta.io.modelcontextprotocol/related-task.taskId

`string`

#### _meta.progressToken?

`string` \| `number`

If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.

#### content

(\{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `text`: `string`; `type`: `"text"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"image"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `data`: `string`; `mimeType`: `string`; `type`: `"audio"`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `description?`: `string`; `icons?`: `object`[]; `mimeType?`: `string`; `name`: `string`; `size?`: `number`; `title?`: `string`; `type`: `"resource_link"`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `annotations?`: \{ `audience?`: (`"user"` \| `"assistant"`)[]; `lastModified?`: `string`; `priority?`: `number`; \}; `resource`: \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `mimeType?`: `string`; `text`: `string`; `uri`: `string`; \} \| \{ `_meta?`: \{\[`key`: `string`\]: `unknown`; \}; `blob`: `string`; `mimeType?`: `string`; `uri`: `string`; \}; `type`: `"resource"`; \})[]

#### isError?

`boolean`

#### structuredContent?

\{\[`key`: `string`\]: `unknown`; \}

### status

[`CacheStatus`](../type-aliases/CacheStatus.md)

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
