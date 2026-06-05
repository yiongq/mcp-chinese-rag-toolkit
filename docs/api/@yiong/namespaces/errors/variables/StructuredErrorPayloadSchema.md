[**@yiong/mcp-chinese-rag-toolkit**](../../../../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../../../../README.md) / [errors](../README.md) / StructuredErrorPayloadSchema

# Variable: StructuredErrorPayloadSchema

> `const` **StructuredErrorPayloadSchema**: `ZodObject`\<\{ `citations`: `ZodOptional`\<`ZodArray`\<`ZodObject`\<\{ `content`: `ZodOptional`\<`ZodString`\>; `page`: `ZodOptional`\<`ZodNumber`\>; `section`: `ZodOptional`\<`ZodString`\>; `source`: `ZodString`; \}, `"strip"`, `ZodTypeAny`, \{ `content?`: `string`; `page?`: `number`; `section?`: `string`; `source`: `string`; \}, \{ `content?`: `string`; `page?`: `number`; `section?`: `string`; `source`: `string`; \}\>, `"many"`\>\>; `confidence`: `ZodOptional`\<`ZodEnum`\<\[`"low"`, `"medium"`, `"high"`\]\>\>; `details`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`\>\>; `error`: `ZodString`; `message`: `ZodString`; `refusal`: `ZodOptional`\<`ZodString`\>; `retryable`: `ZodBoolean`; `suggestions`: `ZodOptional`\<`ZodArray`\<`ZodString`, `"many"`\>\>; \}, `"strip"`, `ZodTypeAny`, \{ `citations?`: `object`[]; `confidence?`: `"low"` \| `"medium"` \| `"high"`; `details?`: `Record`\<`string`, `unknown`\>; `error`: `string`; `message`: `string`; `refusal?`: `string`; `retryable`: `boolean`; `suggestions?`: `string`[]; \}, \{ `citations?`: `object`[]; `confidence?`: `"low"` \| `"medium"` \| `"high"`; `details?`: `Record`\<`string`, `unknown`\>; `error`: `string`; `message`: `string`; `refusal?`: `string`; `retryable`: `boolean`; `suggestions?`: `string`[]; \}\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/server/errors.ts:16](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/server/errors.ts#L16)
