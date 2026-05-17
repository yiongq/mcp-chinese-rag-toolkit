import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface StreamableHttpOptions {
  port: number;
  host?: string;
  /** Max accepted request body size in bytes. Defaults to 4 MiB. */
  maxBodyBytes?: number;
  /** Per-request timeout in ms (covers slow-loris bodies + handler). Defaults to 30 s. */
  requestTimeoutMs?: number;
  /**
   * Allowed Host header values (DNS-rebinding protection). Defaults to `[host, '127.0.0.1', 'localhost']`.
   * Pass an empty array to disable the check (not recommended).
   */
  allowedHosts?: readonly string[];
}

export interface StreamableHttpHandle {
  close(): Promise<void>;
  port: number;
  host: string;
}

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const PARSE_ERROR_CODE = -32700;
const INVALID_REQUEST_CODE = -32600;
const INTERNAL_ERROR_CODE = -32603;

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly rpcCode: number = INVALID_REQUEST_CODE,
  ) {
    super(message);
  }
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    totalBytes += buf.byteLength;
    if (totalBytes > maxBytes) {
      throw new HttpError(413, `Payload too large (>${maxBytes} bytes)`, INVALID_REQUEST_CODE);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    throw new HttpError(400, 'Empty request body', PARSE_ERROR_CODE);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    throw new HttpError(400, 'Empty request body', PARSE_ERROR_CODE);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new HttpError(
      400,
      `Parse error: ${err instanceof Error ? err.message : 'invalid JSON'}`,
      PARSE_ERROR_CODE,
    );
  }
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

function getPath(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function isHostAllowed(req: IncomingMessage, allowedHosts: readonly string[]): boolean {
  if (allowedHosts.length === 0) return true;
  const hostHeader = req.headers.host;
  if (typeof hostHeader !== 'string') return false;
  // Strip port, normalize.
  const bareHost = hostHeader.split(':')[0]?.toLowerCase() ?? '';
  return allowedHosts.some((h) => h.toLowerCase() === bareHost);
}

/**
 * Build a fresh MCP server per request (stateless mode, NFR34).
 * Re-using a single `McpServer` across requests would race: each `server.connect(transport)`
 * rewires the protocol's `_transport` field, breaking in-flight responses.
 */
export async function connectStreamableHttp(
  serverFactory: () => McpServer,
  options: StreamableHttpOptions,
): Promise<StreamableHttpHandle> {
  const host = options.host ?? '127.0.0.1';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const allowedHosts =
    options.allowedHosts ?? Array.from(new Set([host, '127.0.0.1', 'localhost']));

  // Track active per-request transports so close() can drain SSE streams that
  // would otherwise keep `httpServer.close()` hanging forever.
  const activeTransports = new Set<StreamableHTTPServerTransport>();

  const httpServer: HttpServer = createServer((req, res) => {
    res.setTimeout(requestTimeoutMs, () => {
      writeJsonRpcError(res, 408, INTERNAL_ERROR_CODE, 'Request timeout');
      res.destroy();
    });

    if (!isHostAllowed(req, allowedHosts)) {
      writeJsonRpcError(res, 403, INVALID_REQUEST_CODE, 'Host header not allowed');
      return;
    }

    if (getPath(req) !== '/mcp') {
      writeJsonRpcError(res, 404, INVALID_REQUEST_CODE, 'Not Found');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: INVALID_REQUEST_CODE, message: 'Method Not Allowed' },
          id: null,
        }),
      );
      return;
    }

    void (async () => {
      // Parse body BEFORE constructing any transport/server so parse errors don't leak resources.
      let body: unknown;
      try {
        body = await readJsonBody(req, maxBodyBytes);
      } catch (err) {
        if (err instanceof HttpError) {
          writeJsonRpcError(res, err.status, err.rpcCode, err.message);
        } else {
          writeJsonRpcError(
            res,
            500,
            INTERNAL_ERROR_CODE,
            err instanceof Error ? err.message : 'Internal error',
          );
        }
        return;
      }

      // Fresh server + transport per request (SDK-documented stateless pattern).
      const server = serverFactory();
      // NFR9 Phase 2: insert OAuth 2.1 middleware here (loopback/127.0.0.1 exempted per architecture.md L311)
      // SDK requires `sessionIdGenerator: undefined` for stateless mode (NFR34); cast bypasses
      // a SDK typings gap that marks the option non-optional even though the runtime supports it.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as StreamableHTTPServerTransportOptions);
      activeTransports.add(transport);

      let transportClosed = false;
      const closeTransport = (): void => {
        if (transportClosed) return;
        transportClosed = true;
        activeTransports.delete(transport);
        transport.close().catch(() => {
          // Swallow: nothing further to do; client is already gone.
        });
        server.close().catch(() => undefined);
      };

      // Only react to abrupt client disconnect — `'close'` fires on normal completion too,
      // which would race with the SDK's own teardown.
      req.on('aborted', closeTransport);
      res.on('error', closeTransport);

      try {
        await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
        await transport.handleRequest(req, res, body);
      } catch (err) {
        if (!res.headersSent) {
          writeJsonRpcError(
            res,
            500,
            INTERNAL_ERROR_CODE,
            err instanceof Error ? err.message : 'Internal error',
          );
        }
      } finally {
        // Normal completion path — SDK has finished writing; safe to drop refs.
        closeTransport();
      }
    })();
  });

  // Server-level safety net for slow-loris (covers connections without an active res object).
  httpServer.requestTimeout = requestTimeoutMs;

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(options.port, host, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });

  const close = async (): Promise<void> => {
    // Proactively tear down any in-flight transports so long-lived SSE streams
    // don't block `httpServer.close()`.
    for (const t of activeTransports) {
      try {
        await t.close();
      } catch {
        // ignore
      }
    }
    activeTransports.clear();

    // Force-close any lingering keep-alive connections (Node 18.2+).
    if (typeof httpServer.closeAllConnections === 'function') {
      httpServer.closeAllConnections();
    }

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return { close, port: options.port, host };
}
