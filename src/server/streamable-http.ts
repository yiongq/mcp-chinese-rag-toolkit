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

/**
 * CORS configuration for the Streamable HTTP transport (Story 4.6, NFR9 partial / AR-Ext-4).
 *
 * ADR-0006 assigns CORS to the HTTP server (toolkit) tier, not the client. When
 * supplied, the transport echoes a request's `Origin` back in
 * `Access-Control-Allow-Origin` (the specific origin, NOT a bare `*`, so only a
 * whitelisted origin ever receives an ACAO header) and answers `OPTIONS`
 * preflights with `204`. Note: `Access-Control-Allow-Credentials` is NOT sent,
 * so cookie/credentialed cross-origin flows are not enabled — MCP over HTTP does
 * not use them; echoing the specific origin is about strict whitelist semantics,
 * not credentialed access. When omitted, no CORS headers are emitted and
 * `OPTIONS` keeps its pre-Story-4.6 `405` behaviour (backward compatible).
 */
export interface CorsOptions {
  /**
   * Allowed origins. Each entry is matched against the request `Origin` header by:
   *   - exact string equality (e.g. `https://app.example.com`), OR
   *   - a `scheme://*` wildcard that matches any non-empty host of that scheme
   *     (e.g. `chrome-extension://*` matches `chrome-extension://<any-extension-id>`).
   * Wildcard matching is scheme-anchored — `chrome-extension://*` never matches
   * `https://evil.com`. A bare-substring `includes` is intentionally NOT used.
   */
  origins: readonly string[];
}

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
  /**
   * CORS whitelist. Omit to disable CORS entirely (no `Access-Control-*` headers;
   * `OPTIONS` → 405). See {@link CorsOptions}.
   */
  cors?: CorsOptions;
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

const CORS_WILDCARD_SUFFIX = '://*';
const CORS_MAX_AGE_SECONDS = '86400';
// Headers a Streamable HTTP MCP client may send. Used as the fallback when the
// preflight omits `Access-Control-Request-Headers` (we echo that header verbatim
// when present so we never under-allow a future SDK header).
const CORS_DEFAULT_ALLOW_HEADERS =
  'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID';

/**
 * Match a request `Origin` against the configured whitelist. Returns true on an
 * exact match or a scheme-anchored `scheme://*` wildcard match. The wildcard
 * requires a non-empty host after `scheme://` so `chrome-extension://*` matches
 * `chrome-extension://abc` but not the bare `chrome-extension://`.
 */
function matchOrigin(requestOrigin: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === requestOrigin) return true;
    if (pattern.endsWith(CORS_WILDCARD_SUFFIX)) {
      const prefix = pattern.slice(0, pattern.length - 1); // drop trailing '*', keep 'scheme://'
      if (requestOrigin.startsWith(prefix) && requestOrigin.length > prefix.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve the `Access-Control-Allow-Origin` value to echo for this request, or
 * `undefined` when CORS is disabled, the request carries no `Origin`, or the
 * origin is not whitelisted. We echo the specific origin (never `*`) so the
 * whitelist stays strict — only a listed origin gets an ACAO header. (No
 * `Access-Control-Allow-Credentials` is sent, so credentialed flows stay off.)
 */
function resolveCorsOrigin(
  req: IncomingMessage,
  cors: CorsOptions | undefined,
): string | undefined {
  if (cors === undefined) return undefined;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return undefined;
  return matchOrigin(origin, cors.origins) ? origin : undefined;
}

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

    // CORS (Story 4.6): resolve the echo origin once, then set ACAO eagerly so it
    // rides on EVERY /mcp response — preflight, JSON-RPC success, and error
    // envelopes alike (a browser can only read an error body if ACAO is present).
    // `setHeader` persists until the first write; the SDK transport's own
    // `writeHead` merges with (never clears) headers we set here.
    const corsOrigin = resolveCorsOrigin(req, options.cors);
    // Vary on Origin for EVERY CORS-eligible response — match or not — so a shared
    // cache can never replay a no-ACAO response to a whitelisted origin (or echo a
    // whitelisted ACAO to a different origin). Emitting it only on the match path
    // would cache non-matches without `Vary` and risk a cross-origin mismatch.
    // (Story 4.6 code-review.)
    if (options.cors !== undefined) {
      res.setHeader('Vary', 'Origin');
    }
    if (corsOrigin !== undefined) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    }

    // OPTIONS preflight — only intercept when CORS is configured, otherwise fall
    // through to the 405 branch (pre-Story-4.6 behaviour). A non-whitelisted /
    // origin-less OPTIONS still returns 204 but WITHOUT ACAO, so the browser's
    // own CORS check blocks it; the server never 500s on a stray preflight.
    if (options.cors !== undefined && req.method === 'OPTIONS') {
      if (corsOrigin !== undefined) {
        const requested = req.headers['access-control-request-headers'];
        const allowHeaders =
          typeof requested === 'string' && requested.length > 0
            ? requested
            : CORS_DEFAULT_ALLOW_HEADERS;
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': allowHeaders,
          'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS,
        });
      } else {
        res.writeHead(204);
      }
      res.end();
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
