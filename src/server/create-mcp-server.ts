import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { create as createError } from './errors.js';
import type { ResourceDefinition } from './resource-provider.js';
import { connectStdio, type StdioServerHandle } from './stdio.js';
import { connectStreamableHttp, type StreamableHttpHandle } from './streamable-http.js';
import { selectTransport, type TransportKind } from './transport-factory.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<CallToolResult> | CallToolResult;
}

export interface McpServerConfig {
  name: string;
  version: string;
  tools?: McpToolDefinition[];
  resources?: ResourceDefinition[];
  prompts?: unknown[];
  transport?: TransportKind;
  port?: number;
  host?: string;
  /** Forwarded to stdio transport when applicable. Default true. */
  handleSignals?: boolean;
}

export interface McpServerHandle {
  start(): Promise<void>;
  close(): Promise<void>;
  readonly server: McpServer;
}

function wrapHandler(tool: McpToolDefinition): (args: unknown) => Promise<CallToolResult> {
  return async (args: unknown): Promise<CallToolResult> => {
    try {
      return await tool.handler(args);
    } catch (err) {
      const isErr = err instanceof Error;
      const message = isErr ? err.message : String(err);
      const stack = isErr && err.stack !== undefined ? err.stack : undefined;

      // Gate stack on non-production to avoid leaking internal paths over the wire.
      const isProd = process.env.NODE_ENV === 'production';
      const details: Record<string, unknown> = {};
      if (!isProd && stack !== undefined) {
        details.stack = stack;
      }
      // Preserve non-Error throws (e.g. `throw {code: 'X'}`) so debugging info isn't lost.
      if (!isErr && err !== null && typeof err === 'object') {
        details.original = err;
      }
      const hasDetails = Object.keys(details).length > 0;

      return createError('INTERNAL_ERROR', message, {
        retryable: false,
        ...(hasDetails && { details }),
      });
    }
  };
}

// Parity with wrapHandler: gate stack frames on NODE_ENV so resource handler errors
// surface the same redacted message in production as tool errors do.
function sanitizeResourceError(err: unknown, context: 'list' | 'read'): Error {
  const isProd = process.env.NODE_ENV === 'production';
  const isErr = err instanceof Error;
  const message = isErr ? err.message : String(err);
  const sanitized = new Error(`Resource ${context} failed: ${message}`);
  if (isProd || !isErr || err.stack === undefined) {
    sanitized.stack = sanitized.message;
  } else {
    sanitized.stack = err.stack;
  }
  return sanitized;
}

function validateConfig(config: McpServerConfig): void {
  if (typeof config.name !== 'string' || config.name.trim().length === 0) {
    throw new Error("createMcpServer: 'name' must be a non-empty string (MCP Inspector NFR22)");
  }
  if (typeof config.version !== 'string' || config.version.trim().length === 0) {
    throw new Error("createMcpServer: 'version' must be a non-empty string (MCP Inspector NFR22)");
  }
  const seen = new Set<string>();
  for (const tool of config.tools ?? []) {
    if (seen.has(tool.name)) {
      throw new Error(`createMcpServer: duplicate tool name '${tool.name}'`);
    }
    seen.add(tool.name);
  }
  const schemesSeen = new Set<string>();
  for (const resource of config.resources ?? []) {
    if (schemesSeen.has(resource.uriScheme)) {
      throw new Error(`createMcpServer: duplicate resource uriScheme '${resource.uriScheme}'`);
    }
    schemesSeen.add(resource.uriScheme);
  }
}

function buildServer(config: McpServerConfig): McpServer {
  // Story 1.3 Task 4.6 referenced prior-art §2.9's `{ elicitation: {} }` capability,
  // but that pattern is for the MCP *client* (which declares it can receive
  // ElicitRequests). Servers issue ElicitRequests instead, and the SDK's
  // `ServerCapabilities` type intentionally omits `elicitation`. Deferred to Story 1.4
  // when tool-builder helpers add server-side elicitation issuing logic.
  const server = new McpServer({ name: config.name, version: config.version });

  for (const tool of config.tools ?? []) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // The SDK accepts a v3 ZodObject directly via normalizeObjectSchema.
        // Cast required because SDK's union type isn't directly inferable from z.ZodTypeAny.
        inputSchema: tool.inputSchema as never,
      },
      wrapHandler(tool) as never,
    );
  }

  for (const resource of config.resources ?? []) {
    const template = new ResourceTemplate(resource.uriTemplate, {
      list: async () => {
        try {
          const { resources } = await resource.list();
          return { resources };
        } catch (err) {
          throw sanitizeResourceError(err, 'list');
        }
      },
    });
    // SDK metadata is { title, mimeType, ... }; fall back to scheme/text-plain defaults so
    // downstream Inspector / clients always have populated values. Treat empty / whitespace
    // explicit overrides as "not provided" so callers can't accidentally publish blank metadata.
    const trimmedTitle = typeof resource.title === 'string' ? resource.title.trim() : '';
    const trimmedMime = typeof resource.mimeType === 'string' ? resource.mimeType.trim() : '';
    const metadata = {
      title: trimmedTitle.length > 0 ? trimmedTitle : resource.uriScheme,
      mimeType: trimmedMime.length > 0 ? trimmedMime : 'text/plain',
    } as never;
    server.registerResource(resource.uriScheme, template, metadata, (async (
      uri: URL,
      variables: Record<string, string | string[]>,
    ) => {
      // Our template enforces single-segment {kind}/{id}. Flatten array values defensively,
      // but reject empty/missing variables instead of coercing them to '' — silent coercion
      // hides routing bugs and produces opaque "URI not matching" errors downstream.
      const flatten = (v: string | string[] | undefined): string =>
        Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
      const kind = flatten(variables.kind);
      const id = flatten(variables.id);
      if (kind.length === 0 || id.length === 0) {
        throw new Error(
          `createMcpServer: resource '${resource.uriScheme}' read received empty variable ('kind' or 'id') from URI template`,
        );
      }
      // Belt-and-suspenders: URL parsing normalizes '..' / '.' out of `uri.href`, but the
      // SDK template matcher may still hand us raw traversal segments in `variables`.
      // Reject before reaching user-supplied read() — see resource-provider.assertSafeSegments.
      const isTraversal = (s: string): boolean => s === '.' || s === '..' || s.includes('..');
      if (isTraversal(kind) || isTraversal(id)) {
        throw new Error(
          `createMcpServer: resource '${resource.uriScheme}' read rejected traversal-like variable ('.' / '..' / '..*')`,
        );
      }
      try {
        return await resource.read(uri, { kind, id });
      } catch (err) {
        throw sanitizeResourceError(err, 'read');
      }
    }) as never);
  }

  return server;
}

export function createMcpServer(config: McpServerConfig): McpServerHandle {
  validateConfig(config);

  // Primary server instance — used for stdio transport and for in-process test wiring
  // via `handle.server`. HTTP transport intentionally uses fresh server instances per
  // request (see streamable-http.ts) to avoid sharing protocol state across concurrent calls.
  const server = buildServer(config);

  let handle: StdioServerHandle | StreamableHttpHandle | undefined;
  let started = false;
  let closed = false;

  const start = async (): Promise<void> => {
    if (started) return;
    const kind = selectTransport({
      ...(config.transport !== undefined && { transport: config.transport }),
    });
    if (kind === 'stdio') {
      handle = await connectStdio(server, {
        ...(config.handleSignals !== undefined && { handleSignals: config.handleSignals }),
      });
    } else {
      if (config.port === undefined) {
        throw new Error("createMcpServer: 'port' is required when transport='http'");
      }
      handle = await connectStreamableHttp(
        () => {
          // Re-run validation each request — protects against post-construction mutation
          // (`config.tools.push(...)` / scheme rename) that would otherwise let the HTTP
          // surface diverge from the primary stdio server with no clear error path.
          validateConfig(config);
          return buildServer(config);
        },
        {
          port: config.port,
          ...(config.host !== undefined && { host: config.host }),
        },
      );
    }
    // Only mark started AFTER the transport handle is in hand — preserves the
    // ability to retry start() after a recoverable config error (e.g. EADDRINUSE).
    started = true;
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (handle) {
      await handle.close();
    }
    await server.close();
  };

  return {
    start,
    close,
    get server() {
      return server;
    },
  };
}
