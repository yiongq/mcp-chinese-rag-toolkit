[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / shouldSkipWrite

# Function: shouldSkipWrite()

> **shouldSkipWrite**(`result`, `args`): `boolean`

Defined in: [packages/mcp-chinese-rag-toolkit/src/middleware/with-lru-cache.ts:89](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/middleware/with-lru-cache.ts#L89)

Decide whether the just-computed `result` is eligible for cache write.
Returns `true` to SKIP write. Three orthogonal conditions (architecture
L632 / L680-686):

1. `result.isError === true` — re-running may yield a different
   (successful) outcome; caching the error would lock the user out.
2. `result.structuredContent.confidence === 'low'` — low-confidence
   answers are dynamic state (eval threshold tuning, fixture churn);
   caching them would freeze the dynamic surface across reindexing.
3. Any [NON\_CACHEABLE\_ARGS](../variables/NON_CACHEABLE_ARGS.md) key present in `args` AND `!== 'dev'`
   — `env=prod` / `env=test` etc. are write-side hints that the caller
   explicitly does NOT want cached. `env=dev` is the only allow-listed
   value; missing `env` field is also allowed (interpreted as "no
   environment hint"). Strict `!== 'dev'` comparison guards against
   `args.env = NaN` / `undefined` falling through to a wrong branch
  .

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

### args

`unknown`

## Returns

`boolean`
