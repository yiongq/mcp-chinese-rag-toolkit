/**
 * Public package identifier. Retained as a literal-typed sanity constant so
 * downstream consumers can verify ESM / CJS / TS resolution end-to-end.
 */
export const TOOLKIT_NAME = 'mcp-chinese-rag-toolkit' as const;

export type ToolkitName = typeof TOOLKIT_NAME;

export type { Chunk, ChunkOptions, ParsePdfResult, PdfPage } from './rag/index.js';
export { chunk, chunkPdfPages, parsePdf } from './rag/index.js';
export type {
  McpServerConfig,
  McpServerHandle,
  McpToolDefinition,
} from './server/create-mcp-server.js';
export { createMcpServer } from './server/create-mcp-server.js';
export type {
  Citation,
  ConfidenceLevel,
  StructuredErrorPayload,
} from './server/errors.js';
export * as errors from './server/errors.js';
export type { ToolHookContext, ToolHooks } from './server/instrumentation-hooks.js';
export { withHooks } from './server/instrumentation-hooks.js';
export type {
  ResourceDefinition,
  ResourceDefinitionInput,
  ResourceListEntry,
  ResourceReadResult,
} from './server/resource-provider.js';
export { defineResources } from './server/resource-provider.js';
export type { ToolDefinitionInput, ToolExample } from './server/tool-builder.js';
export { defineTool } from './server/tool-builder.js';
