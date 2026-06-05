[**@yiong/mcp-chinese-rag-toolkit**](../README.md)

***

[@yiong/mcp-chinese-rag-toolkit](../README.md) / ensureCanvasAvailable

# Function: ensureCanvasAvailable()

> **ensureCanvasAvailable**(): `Promise`\<`__module`\>

Defined in: [packages/mcp-chinese-rag-toolkit/src/rag/plugins/png-encoder.ts:51](https://github.com/yiongq/mcp-chinese-rag-toolkit/blob/main/src/rag/plugins/png-encoder.ts#L51)

Ensure `@napi-rs/canvas` is available. Resolves to the loaded module
handle (also memoised on `canvasModule`) or throws
[OptionalDependencyMissingError](../classes/OptionalDependencyMissingError.md) with the precise install command.

Called at `withVisionCaption()` factory time so callers see a fail-fast
error at index start rather than partway through processing the first
image.

## Returns

`Promise`\<`__module`\>
